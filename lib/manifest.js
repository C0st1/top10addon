// ============================================================
// Stremio Manifest & Catalog Builder
// Fixes CQ-01: Removed duplicate condition
// ============================================================

const { LRUCache } = require('./cache');
const { DEFAULTS } = require('./constants');
const { toIdSlug, pMap } = require('./utils');
const { fetchFlixPatrolTitles } = require('./scraper');
const { matchTMDB, getRpdbPosterUrl } = require('./tmdb');

// LRU cache for built catalogs
const catalogCache = new LRUCache({
    maxSize: DEFAULTS.CACHE_MAX_FLIXPATROL,
    ttl: DEFAULTS.CACHE_TTL,
});

/**
 * Build the Stremio addon manifest.
 * @param {string} country
 * @param {string[]} multiCountries
 * @param {string} movieType
 * @param {string} seriesType
 * @returns {Object}
 */
function buildManifest(country = "Global", multiCountries = [], movieType = "movie", seriesType = "series") {
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

    const { VERSION } = require('./constants');
    return {
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
}

/**
 * Build a catalog response with stale-while-revalidate support.
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
            // Stale-while-revalidate: return stale data, refresh in background
            fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries).catch((err) => {
                console.warn(`[Catalog] Background revalidation failed for ${cacheKey}:`, err.message);
            });
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
