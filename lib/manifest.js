// ============================================================
// Stremio Manifest & Catalog Builder
// Fixes CQ-01: Removed duplicate condition
// Fixes PERF-04: require() moved to module top level
// Fixes PERF-06: Manifest output cached by input signature
// Fixes PERF-10: In-flight dedup for catalog refresh
// LOG-04 FIX: catalogRefreshInFlight Map has size limit and timeout
// ============================================================

const { LRUCache } = require('./cache');
const { DEFAULTS } = require('./constants');
const { toIdSlug, pMap } = require('./utils');
const { fetchFlixPatrolTitles } = require('./scraper');
const { matchTMDB, getRpdbPosterUrl } = require('./tmdb');
const { VERSION } = require('./constants');

// PERF-04 FIX: All require() calls at module top level

// LRU cache for built catalogs
const catalogCache = new LRUCache({
    maxSize: DEFAULTS.CACHE_MAX_FLIXPATROL,
    ttl: DEFAULTS.CACHE_TTL,
});

// PERF-06 FIX: Manifest cache — avoids rebuilding identical manifests on every request
const manifestCache = new LRUCache({
    maxSize: 500,
    ttl: 5 * 60 * 1000, // 5 minutes (manifests rarely change)
});

// PERF-10 FIX: In-flight dedup for catalog refresh to prevent duplicate work
const catalogRefreshInFlight = new Map();

// LOG-04 FIX: Limits for in-flight dedup map
const CATALOG_IN_FLIGHT_MAX_SIZE = 200;
const CATALOG_IN_FLIGHT_MAX_AGE_MS = 60000; // 60 seconds
let catalogInFlightLastCleaned = Date.now();

/**
 * LOG-04 FIX: Clean up stale or oversized in-flight catalog refresh entries.
 */
function cleanCatalogInFlightMap() {
    const now = Date.now();
    // Time-based cleanup every 60s
    if (now - catalogInFlightLastCleaned > CATALOG_IN_FLIGHT_MAX_AGE_MS) {
        catalogInFlightLastCleaned = now;
        catalogRefreshInFlight.clear();
    }
    // Size-based safety net
    if (catalogRefreshInFlight.size > CATALOG_IN_FLIGHT_MAX_SIZE) {
        console.warn(`[Catalog] In-flight map has ${catalogRefreshInFlight.size} entries — clearing`);
        catalogRefreshInFlight.clear();
    }
}

/**
 * Build a stable cache key from manifest inputs.
 * SEC-034 FIX: Sanitize country values to prevent pipe-char collision in cache key.
 * @private
 */
function getManifestCacheKey(country, multiCountries, movieType, seriesType) {
    // SEC-034 FIX: Remove pipe chars from values to prevent cache key ambiguity
    const safeCountry = (country || '').replace(/[|]/g, '');
    const safeCountries = (multiCountries || []).map(c => c.replace(/[|]/g, '')).join(',');
    const safeMovie = (movieType || '').replace(/[|]/g, '');
    const safeSeries = (seriesType || '').replace(/[|]/g, '');
    return `${safeCountry}|${safeCountries}|${safeMovie}|${safeSeries}`;
}

/**
 * Build the Stremio addon manifest.
 * PERF-06 FIX: Cached by input parameters to avoid redundant computation.
 * @param {string} country
 * @param {string[]} multiCountries
 * @param {string} movieType
 * @param {string} seriesType
 * @returns {Object}
 */
function buildManifest(country = "Global", multiCountries = [], movieType = "movie", seriesType = "series") {
    const cacheKey = getManifestCacheKey(country, multiCountries, movieType, seriesType);
    const cached = manifestCache.peek(cacheKey);
    if (cached) return cached;

    const list = multiCountries.length > 0 ? multiCountries : [country];
    const catalogs = [];

    for (const c of list) {
        if (c.toLowerCase() === "global") {
            catalogs.push(
                { type: movieType, id: "netflix_top10_movies_global", name: "Netflix Top 10 (Global)" },
                { type: seriesType, id: "netflix_top10_series_global", name: "Netflix Top 10 (Global)" }
            );
        } else {
            const idSlug = toIdSlug(c);
            catalogs.push(
                { type: movieType, id: `netflix_top10_movies_${idSlug}`, name: `Netflix Top 10 (${c})` },
                { type: seriesType, id: `netflix_top10_series_${idSlug}`, name: `Netflix Top 10 (${c})` }
            );
        }
    }

    const manifest = {
        id: "org.stremio.netflixtop10",
        version: VERSION,
        name: "Netflix Top 10",
        description: "Live Netflix Top 10 rankings per-country with precise Stremio catalogs.",
        logo: "https://img.icons8.com/color/256/netflix.png",
        types: [...new Set([movieType, seriesType])],
        catalogs,
        resources: ["catalog"],
        behaviorHints: { configurable: true },
        config: [
            { key: "tmdbApiKey", type: "text", title: "TMDB API Key", required: true }
        ],
    };

    manifestCache.set(cacheKey, manifest);
    return manifest;
}

/**
 * Build a catalog response with stale-while-revalidate support.
 * PERF-10 FIX: In-flight dedup prevents duplicate background refreshes.
 * LOG-04 FIX: In-flight map cleaned periodically and size-limited.
 * @param {string} type - "movie" or "series"
 * @param {string} catalogId
 * @param {string} apiKey
 * @param {string|null} rpdbApiKey
 * @param {string[]} multiCountries
 * @returns {Promise<Object[]>}
 */
async function buildCatalog(type, catalogId, apiKey, rpdbApiKey, multiCountries) {
    const cacheKey = `${type}_${catalogId}`;
    const cached = catalogCache.getStale(cacheKey);
    let metas = cached.data;

    if (!metas || cached.stale) {
        if (cached.data && cached.stale) {
            // LOG-04 FIX: Clean in-flight map before checking
            cleanCatalogInFlightMap();

            // Check if a refresh is already in-flight for this key
            if (!catalogRefreshInFlight.has(cacheKey)) {
                const refreshPromise = fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries)
                    .catch((err) => {
                        console.warn(`[Catalog] Background revalidation failed for ${cacheKey}:`, err.message);
                    })
                    .finally(() => {
                        catalogRefreshInFlight.delete(cacheKey);
                    });
                catalogRefreshInFlight.set(cacheKey, refreshPromise);
            }
        } else {
            metas = await fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries);
        }
    }

    return (metas || []).map(m => {
        const rpdbP = getRpdbPosterUrl(m.id, rpdbApiKey);
        return { ...m, poster: rpdbP || m.tmdbPoster, tmdbPoster: undefined };
    });
}

/**
 * Fetch fresh catalog data from FlixPatrol + TMDB.
 * @private
 */
async function fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries) {
    const isGlobal = catalogId.endsWith("_global");
    const tmdbType = type === "movie" ? "movie" : "tv";
    const categoryType = type === "movie" ? "Films" : "TV";

    let targetCountry = "Global";
    // CQ-01 FIX: Removed redundant duplicate condition check
    if (!isGlobal) {
        const prefix = catalogId.includes("movies_") ? "netflix_top10_movies_" : "netflix_top10_series_";
        const idSlug = catalogId.replace(prefix, "");
        targetCountry = multiCountries.find(c => toIdSlug(c) === idSlug) || idSlug;
    }

    const items = await fetchFlixPatrolTitles(categoryType, targetCountry);
    if (items.length === 0) return [];

    const metas = (await pMap(items, (item) => matchTMDB(item, tmdbType, apiKey), DEFAULTS.TMDB_CONCURRENCY))
        .filter(v => v !== null && v !== undefined);

    if (metas.length > 0) {
        catalogCache.set(cacheKey, metas);
    }
    return metas;
}

module.exports = {
    buildManifest,
    buildCatalog,
};
