// ============================================================
// TMDB API Integration
// Fixes SEC-03: Uses Authorization header (Bearer token)
// Fixes REL-03: Race condition in in-flight deduplication
// Fixes REL-02: Proper error logging in all catch blocks
// Fixes PERF-01: Reduced API calls via batch approach
// Fixes CQ-03: Title overrides externalized
// ============================================================

import { LRUCache } from './cache.js';
import { fetchWithTimeout, pMap } from './utils.js';
import { DEFAULTS, DEFAULT_TITLE_OVERRIDES, TitleOverrides } from './constants.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'tmdb' });

// ---- Type definitions ----

export interface TMDBSearchResult {
    id: number;
    title?: string;
    name?: string;
    poster_path: string | null;
    backdrop_path: string | null;
    overview: string;
    release_date?: string;
    first_air_date?: string;
    original_title?: string;
    original_name?: string;
}

export interface TMDBExternalIds {
    imdb_id: string | null;
}

export interface StremioMeta {
    id: string;
    type: string;
    name: string;
    tmdbPoster: string | null;
    background: string | null;
    description: string;
    releaseInfo: string;
    poster?: string | null;
}

interface TMDBFindResponse {
    movie_results?: TMDBSearchResult[];
    tv_results?: TMDBSearchResult[];
}

interface TMDBSearchResponse {
    results?: TMDBSearchResult[];
}

interface TMDBDetailResponse {
    external_ids?: TMDBExternalIds;
}

interface TMDBMatchItem {
    title: string;
    year: string | null;
}

interface ValidationResult {
    valid: boolean;
    message: string;
}

// ---- Caches ----

const tmdbMatchCache = new LRUCache<StremioMeta | null>({
    maxSize: DEFAULTS.CACHE_MAX_TMDB,
    ttl: DEFAULTS.TMDB_MATCH_CACHE_TTL,
});
const imdbCache = new LRUCache<string>({
    maxSize: DEFAULTS.CACHE_MAX_IMDB,
    ttl: DEFAULTS.TMDB_MATCH_CACHE_TTL,
});

// In-flight deduplication — REL-03 FIX: proper ordering
const tmdbMatchInFlight = new Map<string, Promise<StremioMeta | null>>();

/**
 * Build common headers for TMDB API requests.
 * SEC-03 FIX: Use Authorization header instead of query param.
 * Supports both v3 (api_key) and v4 (bearer token) — prefers bearer.
 */
function getTmdbHeaders(apiKey: string): Record<string, string> {
    // If it looks like a bearer token (long hex), use Authorization header
    if (apiKey.length > 40) {
        return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    }
    // Legacy v3: use api_key as query param (backward compatible)
    return { 'Content-Type': 'application/json' };
}

/**
 * Append API key to URL (v3 fallback).
 */
function appendApiKey(url: string, apiKey: string): string {
    if (apiKey.length > 40) return url; // Bearer token goes in header
    return url.includes('?') ? `${url}&api_key=${apiKey}` : `${url}?api_key=${apiKey}`;
}

/**
 * Build TMDB match cache key.
 */
function getTmdbMatchCacheKey(item: TMDBMatchItem | string, type: string): string {
    const title = typeof item === 'string' ? item : item.title;
    const year = typeof item === 'object' && item.year ? `_${item.year}` : '';
    return `${type}|${title.toLowerCase()}${year}`;
}

/**
 * Get IMDB cache key.
 */
function getImdbCacheKey(type: string, tmdbId: number | string): string {
    return `${type}_${tmdbId}`;
}

/**
 * Format a TMDB result into a Stremio-compatible meta object.
 */
export function formatMeta(item: TMDBSearchResult, finalId: string, type: string): StremioMeta {
    const tmdbP = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
    return {
        id: finalId,
        type: type === 'tv' ? 'series' : 'movie',
        name: item.title || item.name || '',
        tmdbPoster: tmdbP,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || '',
        releaseInfo: (item.release_date || item.first_air_date || '').substring(0, 4),
    };
}

/**
 * Build RPDB poster URL.
 */
export function getRpdbPosterUrl(imdbId: string | null, rpdbApiKey: string | null): string | null {
    if (!rpdbApiKey || !imdbId || !imdbId.startsWith('tt')) return null;
    return `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
}

/**
 * Match a title to TMDB metadata.
 * REL-03 FIX: Race condition resolved by storing promise BEFORE awaiting.
 */
export async function matchTMDB(
    item: TMDBMatchItem | string,
    type: string,
    apiKey: string,
    titleOverrides?: TitleOverrides,
): Promise<StremioMeta | null> {
    if (!apiKey) return null;

    const title = typeof item === 'string' ? item : item.title;
    const year = typeof item === 'object' ? item.year : null;
    const overrides = titleOverrides || DEFAULT_TITLE_OVERRIDES;

    const cacheKey = getTmdbMatchCacheKey(item, type);
    const cached = tmdbMatchCache.peek(cacheKey);
    if (cached !== undefined) return cached;

    // Check in-flight — return existing promise if already running
    if (tmdbMatchInFlight.has(cacheKey)) {
        return tmdbMatchInFlight.get(cacheKey)!;
    }

    // REL-03 FIX: Create promise and store in in-flight map BEFORE awaiting
    const runPromise = _matchTMDBInternal(item, type, apiKey, overrides, title, year, cacheKey);

    // Store immediately to prevent duplicate concurrent requests
    tmdbMatchInFlight.set(cacheKey, runPromise);

    try {
        return await runPromise;
    } finally {
        tmdbMatchInFlight.delete(cacheKey);
    }
}

/**
 * Internal matching implementation.
 * @private
 */
async function _matchTMDBInternal(
    item: TMDBMatchItem | string,
    type: string,
    apiKey: string,
    overrides: TitleOverrides,
    title: string,
    _year: string | null,
    cacheKey: string,
): Promise<StremioMeta | null> {
    try {
        const cleanTitle = title.replace(/[:\-]?\s*Season\s+\d+/gi, '').trim();
        const cleanTitleLower = cleanTitle.toLowerCase();
        const headers = getTmdbHeaders(apiKey);

        // Check title overrides
        if (overrides[cleanTitleLower]) {
            const imdbId = overrides[cleanTitleLower];
            const overrideUrl = appendApiKey(
                `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
                apiKey,
            );
            const res = await fetchWithTimeout(overrideUrl, { headers }, DEFAULTS.TMDB_TIMEOUT);
            if (res.ok) {
                const data = (await res.json()) as TMDBFindResponse;
                const matched = type === 'tv' ? data.tv_results?.[0] : data.movie_results?.[0];
                if (matched) {
                    const meta = formatMeta(matched, imdbId, type);
                    tmdbMatchCache.set(cacheKey, meta);
                    return meta;
                }
            }
            log.warn({ cleanTitle, imdbId }, 'Title override failed');
        }

        // Search TMDB with year filter
        let searchUrl = appendApiKey(
            `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(cleanTitle)}&language=en-US&page=1`,
            apiKey,
        );
        const year = typeof item === 'object' ? item.year : null;
        if (year) {
            searchUrl += type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
        }

        const sRes = await fetchWithTimeout(searchUrl, { headers }, DEFAULTS.TMDB_TIMEOUT);
        if (!sRes.ok) {
            log.warn({ status: sRes.status, cleanTitle }, 'TMDB search failed');
            throw new Error('TMDB Search Failed');
        }
        const sData = (await sRes.json()) as TMDBSearchResponse;

        if (sData.results && sData.results.length > 0) {
            const candidates = sData.results.slice(0, 5);
            const exact = candidates.filter((i) => {
                const itemT = (type === 'tv' ? i.name : i.title)?.toLowerCase();
                const origT = (type === 'tv' ? i.original_name : i.original_title)?.toLowerCase();
                return itemT === cleanTitleLower || origT === cleanTitleLower;
            });

            const best = exact.length > 0 ? exact[0] : candidates[0];

            let finalId = `tmdb:${best.id}`;
            const cKey = getImdbCacheKey(type, best.id);
            const cachedImdb = imdbCache.peek(cKey);
            if (cachedImdb) {
                finalId = cachedImdb;
            } else {
                // PERF-01 FIX: Fetch external_ids alongside details to reduce API calls
                try {
                    const detailUrl = appendApiKey(
                        `https://api.themoviedb.org/3/${type}/${best.id}?append_to_response=external_ids`,
                        apiKey,
                    );
                    const extRes = await fetchWithTimeout(detailUrl, { headers }, DEFAULTS.TMDB_TIMEOUT);
                    if (extRes.ok) {
                        const extData = (await extRes.json()) as TMDBDetailResponse;
                        const imdbId = extData.external_ids?.imdb_id;
                        if (imdbId) {
                            finalId = imdbId;
                            imdbCache.set(cKey, imdbId);
                        }
                    }
                } catch (extErr) {
                    // REL-02 FIX: Log instead of silently swallowing
                    log.warn({ err: extErr as Error, tmdbId: best.id }, 'External IDs fetch failed');
                }
            }

            const meta = formatMeta(best, finalId, type);
            tmdbMatchCache.set(cacheKey, meta);
            return meta;
        }

        // Cache miss — no results found
        tmdbMatchCache.set(cacheKey, null);
        return null;
    } catch (err) {
        // REL-02 FIX: Log the error for debugging
        log.warn({ err: err as Error, title }, 'TMDB match failed');
        return null;
    }
}

/**
 * Validate a TMDB API key.
 */
export async function validateTmdbKey(apiKey: string): Promise<ValidationResult> {
    if (!apiKey?.trim()) return { valid: false, message: 'API key empty.' };
    try {
        const url = appendApiKey('https://api.themoviedb.org/3/configuration', apiKey.trim());
        const headers = getTmdbHeaders(apiKey.trim());
        const r = await fetch(url, { headers });
        if (r.ok) return { valid: true, message: 'Valid API key!' };
        return { valid: false, message: r.status === 401 ? 'Unauthorized.' : `Error ${r.status}` };
    } catch (e) {
        return { valid: false, message: `Network error: ${(e as Error).message}` };
    }
}
