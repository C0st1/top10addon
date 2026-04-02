// ============================================================
// Config Store — Encrypted stateless token-based configuration
// SEC-01 FIX: ENCRYPTION_KEY required at startup — no predictable fallback
// SEC-01b FIX: PBKDF2 key derivation with 310,000 iterations (OWASP 2023)
// SEC-04 FIX: Added token expiry (90-day TTL)
// ============================================================

const crypto = require('crypto');
const { generateToken } = require('./utils');
const { DEFAULTS, ALLOWED_CATALOG_TYPES } = require('./constants');

// SEC-01 FIX: ENCRYPTION_KEY is required — fail fast if not set.
// The old predictable fallback ('netflix-top10-addon-default-key-' + host)
// allowed anyone who knows the Vercel URL to decrypt all tokens.
// Generate a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error(
        '[ConfigStore] FATAL: ENCRYPTION_KEY environment variable is required and must be at least 32 characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ' +
        'Then set it in Vercel: vercel env add ENCRYPTION_KEY'
    );
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// SEC-04 FIX: Tokens expire after 90 days
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// SEC-01b FIX: PBKDF2 parameters — OWASP 2023 recommended: 310,000 iterations for SHA-256
const PBKDF2_ITERATIONS = 310000;
const PBKDF2_KEY_LENGTH = 32; // 256 bits for AES-256

// Cache the derived key to avoid re-deriving on every request
let _derivedKey = null;

/**
 * SEC-01b FIX: Derive a 32-byte key from the encryption key via PBKDF2.
 * PBKDF2 with 310,000 iterations is the OWASP 2023 recommendation for
 * password/key stretching. This makes brute-force attacks significantly
 * more expensive than a single SHA-256 hash.
 * The salt is fixed (application-level key, not per-user) since ENCRYPTION_KEY
 * is already a high-entropy random value (not a human password).
 * @returns {Buffer}
 */
function deriveKey() {
    if (_derivedKey) return _derivedKey;

    // Use the application name as a fixed salt — this is acceptable because
    // ENCRYPTION_KEY is already a cryptographically random value (not a password).
    // Per-token salts are not needed because each token already has a random IV.
    const salt = Buffer.from('netflix-top10-stremio-addon-v3-salt');

    _derivedKey = crypto.pbkdf2Sync(
        ENCRYPTION_KEY,
        salt,
        PBKDF2_ITERATIONS,
        PBKDF2_KEY_LENGTH,
        'sha256'
    );

    return _derivedKey;
}

/**
 * Encrypt data and return base64 encoded string.
 * Uses AES-256-GCM for authenticated encryption.
 * @param {Object} data
 * @returns {string}
 */
function encrypt(data) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt base64 encoded string and return data.
 * Returns null if decryption fails (wrong key, tampered data, etc.)
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

        const key = deriveKey();
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
 * SEC-016 FIX: Field allowlisting — only extracts known safe fields.
 * Rejects tokens with unknown fields to prevent field injection.
 * @param {string} configStr
 * @returns {Object|null}
 */
function parseConfig(configStr) {
    try {
        // Handle URL-encoded JSON (legacy format)
        const decoded = decodeURIComponent(configStr);
        const config = JSON.parse(decoded);
        if (!config?.tmdbApiKey?.trim()) return null;

        // SEC-016 FIX: Only allow known fields — reject unexpected keys
        const knownFields = ['tmdbApiKey', 'rpdbApiKey', 'country', 'movieType', 'seriesType'];
        const configKeys = Object.keys(config);
        for (const key of configKeys) {
            if (!knownFields.includes(key)) return null;
        }

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
