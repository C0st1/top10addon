// ============================================================
// Config Store — Opaque token-based configuration storage
// Fixes SEC-02: API keys no longer embedded in URLs
// ============================================================

const { LRUCache } = require('./cache');
const { generateToken } = require('./utils');
const { DEFAULTS } = require('./constants');

// LRU cache for config tokens
const configStore = new LRUCache({
    maxSize: DEFAULTS.CONFIG_STORE_MAX,
    ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
});

/**
 * Save a configuration and return an opaque token.
 * The token can be used in manifest/catalog URLs without exposing credentials.
 *
 * @param {Object} config - User configuration
 * @param {string} config.tmdbApiKey
 * @param {string} [config.rpdbApiKey]
 * @param {string} config.country - Comma-separated countries
 * @param {string} [config.movieType]
 * @param {string} [config.seriesType]
 * @returns {{token: string, manifestUrl: string, installUrl: string}}
 */
function saveConfig(config, baseUrl) {
    const token = generateToken();
    configStore.set(token, {
        ...config,
        createdAt: Date.now(),
    });
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const manifestUrl = `${cleanBase}/${token}/manifest.json`;
    const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
    return { token, manifestUrl, installUrl };
}

/**
 * Look up configuration by opaque token.
 * @param {string} token
 * @returns {Object|null}
 */
function getConfig(token) {
    const result = configStore.get(token);
    return result.data;
}

/**
 * Parse a legacy encoded config from URL (backward compatibility).
 * @param {string} configStr
 * @returns {Object|null}
 */
function parseConfig(configStr) {
    try {
        const config = JSON.parse(decodeURIComponent(configStr));
        if (!config?.tmdbApiKey?.trim()) return null;
        const mc = (config.country || "Global").split(",").map(c => c.trim()).filter(c => c);
        return {
            tmdbApiKey: config.tmdbApiKey.trim(),
            rpdbApiKey: config.rpdbApiKey?.trim() || null,
            country: mc[0] || "Global",
            multiCountries: mc,
            movieType: config.movieType ? config.movieType.trim() : "movie",
            seriesType: config.seriesType ? config.seriesType.trim() : "series",
        };
    } catch (err) {
        console.warn(`[Config] Failed to parse config string:`, err.message);
        return null;
    }
}

/**
 * Normalize a config object (from store or parsed) to a standard shape.
 * @param {Object} config
 * @returns {Object|null}
 */
function normalizeConfig(config) {
    if (!config?.tmdbApiKey?.trim()) return null;
    const mc = (config.country || "Global").split(",").map(c => c.trim()).filter(c => c);
    return {
        tmdbApiKey: config.tmdbApiKey.trim(),
        rpdbApiKey: config.rpdbApiKey?.trim() || null,
        country: mc[0] || "Global",
        multiCountries: mc,
        movieType: (config.movieType ? config.movieType.trim() : "") || "movie",
        seriesType: (config.seriesType ? config.seriesType.trim() : "") || "series",
    };
}

module.exports = {
    saveConfig,
    getConfig,
    parseConfig,
    normalizeConfig,
};
