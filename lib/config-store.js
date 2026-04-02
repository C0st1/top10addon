// ============================================================
// Config Store — Encrypted stateless token-based configuration
// SEC-01 FIX: Encryption key from env with secure fallback for backward compat
// SEC-04 FIX: Added token expiry (90-day TTL)
// ============================================================

const crypto = require('crypto');
const { generateToken } = require('./utils');
const { DEFAULTS, ALLOWED_CATALOG_TYPES } = require('./constants');

// SEC-01 FIX: Prefer ENCRYPTION_KEY from env; fall back to derived default
// so existing deployments without this env var continue to work.
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    // Derive a stable default from a project identifier + Vercel URL
    // This is NOT secret — it just ensures tokens are consistent within one deployment.
    // Users should set ENCRYPTION_KEY for real security.
    const host = process.env.VERCEL_URL || 'netflix-top10-stremio-addon-v3';
    ENCRYPTION_KEY = 'netflix-top10-addon-default-key-' + host;
    console.warn('[ConfigStore] ENCRYPTION_KEY not set — using deployment-derived default. Set ENCRYPTION_KEY env var for production security.');
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// SEC-04 FIX: Tokens expire after 90 days
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Derive a 32-byte key from the encryption key via SHA-256.
 * @param {string} key
 * @returns {Buffer}
 */
function deriveKey(key) {
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt data and return base64 encoded string.
 * @param {Object} data
 * @returns {string}
 */
function encrypt(data) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(ENCRYPTION_KEY);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt base64 encoded string and return data.
 * @param {string} encryptedData
 * @returns {Object|null}
 */
function decrypt(encryptedData) {
    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) return null;

        const iv = Buffer.from(parts[0], 'base64');
        const authTag = Buffer.from(parts[1], 'base64');
        const encrypted = parts[2];

        const key = deriveKey(ENCRYPTION_KEY);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

/**
 * Validate and sanitize a type override string.
 * Only allows known safe values or custom alphanumeric names.
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
function validateTypeOverride(value, fallback) {
    if (!value || typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    // Allow known safe type values (lowercase match)
    if (ALLOWED_CATALOG_TYPES.includes(trimmed.toLowerCase())) {
        return trimmed.toLowerCase();
    }

    // Allow custom names but sanitize: alphanumeric + spaces + hyphens, max 50 chars
    const sanitized = trimmed.replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 50).trim();
    return sanitized || fallback;
}

/**
 * Save a configuration and return an encrypted token.
 * The token contains the encrypted config — no server-side storage needed.
 * This works in serverless environments where memory doesn't persist.
 *
 * @param {Object} config - User configuration
 * @param {string} config.tmdbApiKey
 * @param {string} [config.rpdbApiKey]
 * @param {string} config.country - Comma-separated countries
 * @param {string} [config.movieType]
 * @param {string} [config.seriesType]
 * @param {string} baseUrl - Base URL for manifest
 * @returns {{token: string, manifestUrl: string, installUrl: string}}
 */
function saveConfig(config, baseUrl) {
    const configData = {
        tmdbApiKey: String(config.tmdbApiKey || '').trim(),
        rpdbApiKey: config.rpdbApiKey ? String(config.rpdbApiKey).trim() : '',
        country: String(config.country || 'Global'),
        movieType: validateTypeOverride(config.movieType, 'movie'),
        seriesType: validateTypeOverride(config.seriesType, 'series'),
        createdAt: Date.now(),
    };

    // Encrypt the config and use as token
    const encryptedToken = encrypt(configData);
    // Make it URL-safe (replace +, /, =, and : for URL compatibility)
    const token = encryptedToken
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '~')
        .replace(/:/g, '.');

    const cleanBase = baseUrl.replace(/\/+$/, '');
    const manifestUrl = `${cleanBase}/${token}/manifest.json`;
    const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

    return { token, manifestUrl, installUrl };
}

/**
 * Look up configuration by encrypted token.
 * SEC-04 FIX: Returns null if token has expired (older than 90 days).
 * @param {string} token
 * @returns {Object|null}
 */
function getConfig(token) {
    if (!token || typeof token !== 'string') return null;
    // Convert URL-safe back to standard base64
    const encryptedToken = token
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/~/g, '=')
        .replace(/\./g, ':');

    const config = decrypt(encryptedToken);
    if (!config) return null;

    // SEC-04 FIX: Reject expired tokens
    if (config.createdAt && (Date.now() - config.createdAt > TOKEN_MAX_AGE_MS)) {
        return null;
    }

    return {
        tmdbApiKey: config.tmdbApiKey || '',
        rpdbApiKey: config.rpdbApiKey || '',
        country: config.country || 'Global',
        movieType: config.movieType || 'movie',
        seriesType: config.seriesType || 'series',
        createdAt: config.createdAt,
    };
}

/**
 * Parse a legacy encoded config from URL (backward compatibility).
 * @param {string} configStr
 * @returns {Object|null}
 */
function parseConfig(configStr) {
    try {
        // Handle URL-encoded JSON (legacy format)
        const decoded = decodeURIComponent(configStr);
        const config = JSON.parse(decoded);
        if (!config?.tmdbApiKey?.trim()) return null;
        const mc = (config.country || "Global").split(",").map(c => c.trim()).filter(c => c);
        return {
            tmdbApiKey: config.tmdbApiKey.trim(),
            rpdbApiKey: config.rpdbApiKey?.trim() || null,
            country: mc[0] || "Global",
            multiCountries: mc,
            movieType: validateTypeOverride(config.movieType, 'movie'),
            seriesType: validateTypeOverride(config.seriesType, 'series'),
        };
    } catch (err) {
        // Not a valid legacy config — could be a new encrypted token
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
        movieType: validateTypeOverride(config.movieType, 'movie'),
        seriesType: validateTypeOverride(config.seriesType, 'series'),
    };
}

module.exports = {
    saveConfig,
    getConfig,
    parseConfig,
    normalizeConfig,
};
