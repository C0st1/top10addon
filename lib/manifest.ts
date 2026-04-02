// ============================================================
// Stremio Manifest & Catalog Builder
// Multi-platform support with configurable platform parameter
// ============================================================

import { LRUCache } from './cache.js';
import { DEFAULTS, VERSION } from './constants.js';
import { toIdSlug, pMap } from './utils.js';
import { fetchFlixPatrolTitles } from './scraper.js';
import { matchTMDB, getRpdbPosterUrl, StremioMeta } from './tmdb.js';

export interface StremioManifest {
    id: string;
    version: string;
    name: string;
    description: string;
    logo: string;
    types: string[];
    catalogs: StremioCatalog[];
    resources: string[];
    behaviorHints: Record<string, unknown>;
    config: StremioConfigField[];
}

export interface StremioCatalog {
    type: string;
    id: string;
    name: string;
}

export interface StremioConfigField {
    key: string;
    type: string;
    title: string;
    required?: boolean;
}

// LRU cache for built catalogs
const catalogCache = new LRUCache<StremioMeta[]>({
    maxSize: DEFAULTS.CACHE_MAX_FLIXPATROL,
    ttl: DEFAULTS.CACHE_TTL,
});

/**
 * Platform display names and icon URLs for multi-platform support.
 */
const PLATFORM_META: Record<string, { label: string; icon: string }> = {
    'netflix': { label: 'Netflix', icon: 'https://img.icons8.com/color/256/netflix.png' },
    'prime-video': { label: 'Prime Video', icon: 'https://img.icons8.com/color/256/amazon-prime-video.png' },
    'disney-plus': { label: 'Disney+', icon: 'https://img.icons8.com/color/256/disney-plus.png' },
    'hbo-max': { label: 'HBO Max', icon: 'https://img.icons8.com/color/256/hbo.png' },
    'apple-tv-plus': { label: 'Apple TV+', icon: 'https://img.icons8.com/color/256/apple-tv.png' },
    'hulu': { label: 'Hulu', icon: 'https://img.icons8.com/color/256/hulu.png' },
};

/**
 * Get platform metadata (label, icon). Defaults to Netflix.
 */
export function getPlatformMeta(platform: string): { label: string; icon: string } {
    return PLATFORM_META[platform] || PLATFORM_META['netflix'];
}

/**
 * Build the Stremio addon manifest.
 * @param country - Default country
 * @param multiCountries - List of countries for multi-country catalogs
 * @param movieType - Stremio type for movies (default "movie")
 * @param seriesType - Stremio type for series (default "series")
 * @param platform - Streaming platform (default "netflix")
 */
export function buildManifest(
    country: string = 'Global',
    multiCountries: string[] = [],
    movieType: string = 'movie',
    seriesType: string = 'series',
    platform: string = 'netflix',
): StremioManifest {
    const meta = getPlatformMeta(platform);
    const list = multiCountries.length > 0 ? multiCountries : [country];
    const catalogs: StremioCatalog[] = [];

    for (const c of list) {
        if (c.toLowerCase() === 'global') {
            catalogs.push(
                { type: movieType, id: `${platform}_top10_movies_global`, name: `${meta.label} Top 10 (Global)` },
                { type: seriesType, id: `${platform}_top10_series_global`, name: `${meta.label} Top 10 (Global)` },
            );
        } else {
            const idSlug = toIdSlug(c);
            catalogs.push(
                { type: movieType, id: `${platform}_top10_movies_${idSlug}`, name: `${meta.label} Top 10 (${c})` },
                { type: seriesType, id: `${platform}_top10_series_${idSlug}`, name: `${meta.label} Top 10 (${c})` },
            );
        }
    }

    return {
        id: `org.stremio.${platform}top10`,
        version: VERSION,
        name: `${meta.label} Top 10`,
        description: `Live ${meta.label} Top 10 rankings per-country with precise Stremio catalogs.`,
        logo: meta.icon,
        types: [...new Set([movieType, seriesType])],
        catalogs,
        resources: ['catalog'],
        behaviorHints: { configurable: true },
        config: [{ key: 'tmdbApiKey', type: 'text', title: 'TMDB API Key', required: true }],
    };
}

/**
 * Build a catalog response with stale-while-revalidate support.
 */
export async function buildCatalog(
    type: string,
    catalogId: string,
    apiKey: string,
    rpdbApiKey: string | null,
    multiCountries: string[],
    platform: string = 'netflix',
): Promise<StremioMeta[]> {
    const cacheKey = `${type}_${catalogId}`;
    const cached = catalogCache.getStale(cacheKey);
    let metas: StremioMeta[] | null = cached.data;

    if (!metas || cached.stale) {
        if (cached.data && cached.stale) {
            // Stale-while-revalidate: return stale data, refresh in background
            fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries, platform).catch((err) => {
                console.warn(
                    `[Catalog] Background revalidation failed for ${cacheKey}:`,
                    (err as Error).message,
                );
            });
        } else {
            metas = await fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries, platform);
        }
    }

    return (metas || []).map((m) => {
        const rpdbP = getRpdbPosterUrl(m.id, rpdbApiKey);
        return { ...m, poster: rpdbP || m.tmdbPoster, tmdbPoster: null as string | null };
    });
}

/**
 * Fetch fresh catalog data from FlixPatrol + TMDB.
 * @private
 */
async function fetchCatalogFresh(
    cacheKey: string,
    type: string,
    catalogId: string,
    apiKey: string,
    multiCountries: string[],
    _platform: string,
): Promise<StremioMeta[]> {
    const isGlobal = catalogId.endsWith('_global');
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const categoryType = type === 'movie' ? 'Films' : 'TV';

    let targetCountry = 'Global';
    if (!isGlobal) {
        // Support platform-agnostic catalog IDs: "{platform}_top10_{movies|series}_{slug}"
        const prefixMatch = catalogId.match(/^(.+?)_top10_(?:movies|series)_(.+)$/);
        if (prefixMatch) {
            const idSlug = prefixMatch[2];
            targetCountry = multiCountries.find((c) => toIdSlug(c) === idSlug) || idSlug.replace(/_/g, ' ');
        }
    }

    const items = await fetchFlixPatrolTitles(categoryType, targetCountry);
    if (items.length === 0) return [];

    const metas = (
        await pMap(
            items,
            (item) => matchTMDB(item, tmdbType, apiKey),
            DEFAULTS.TMDB_CONCURRENCY,
        )
    ).filter((v): v is StremioMeta => v !== null && v !== undefined);

    if (metas.length > 0) {
        catalogCache.set(cacheKey, metas);
    }
    return metas;
}
