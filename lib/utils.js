// ============================================================
// Utility Functions — shared helpers
// RD-03 FIX: Moved crypto require to module top level (PERF-04)
// ============================================================

const crypto = require('crypto'); // RD-03 FIX: top-level import

/**
 * Fetch with abort timeout.
 * @param {string} url
 * @param {RequestInit} opts
 * @param {number} ms - timeout in milliseconds
 */
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

/**
 * Promise-map with concurrency limit.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} fn
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
async function pMap(items, fn, concurrency = 5) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);
        if (executing.size >= concurrency) await Promise.race(executing);
    }
    return Promise.all(results);
}

/**
 * Convert country name to URL slug for FlixPatrol.
 * @param {string} country
 * @returns {string}
 */
function getFlixPatrolSlug(country) {
    if (!country) return "world";
    const lower = country.toLowerCase();
    if (lower === "global" || lower === "worldwide") return "world";
    return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Convert country name to catalog ID slug.
 * @param {string} c
 * @returns {string}
 */
function toIdSlug(c) {
    // Must use dashes to match FlixPatrol URL format (e.g., "czech-republic", "south-korea")
    // Original code used getFlixPatrolSlug() which produces dash-separated slugs.
    // The manifest and catalog handlers both call this, so it must be consistent.
    const lower = c.toLowerCase();
    if (lower === "global" || lower === "worldwide") return "global";
    return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * SEC-013 FIX: Escape string for safe inclusion in a JavaScript string literal.
 * Now handles ALL critical characters: backslash, quotes, angle brackets,
 * newlines, carriage returns, null bytes, forward slashes, and Unicode line separators.
 * @param {string} str
 * @returns {string}
 */
function escapeJs(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\0/g, '\\0')
        .replace(/\//g, '\\/')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// ============================================================
// SEC-12 FIX: Token generation using crypto.randomBytes (no bias)
// Uses rejection sampling to avoid modular bias with 62-char alphabet.
// RD-03 FIX: crypto already imported at module top level
// ============================================================

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 32;
const TOKEN_CHAR_MAX = 256 - (256 % TOKEN_CHARS.length); // 252 — largest multiple of 62 <= 256

/**
 * Generate a cryptographically secure token with no modular bias.
 * RD-03 FIX: Uses module-level crypto import, no require() inside function.
 * @returns {string}
 */
function generateToken() {
    let result = '';
    while (result.length < TOKEN_LENGTH) {
        const buf = crypto.randomBytes(TOKEN_LENGTH);
        for (let i = 0; i < buf.length && result.length < TOKEN_LENGTH; i++) {
            if (buf[i] < TOKEN_CHAR_MAX) {
                result += TOKEN_CHARS[buf[i] % TOKEN_CHARS.length];
            }
        }
    }
    return result;
}

// ============================================================
// SEC-06 FIX: In-memory sliding-window rate limiter
// Per-IP, per-route rate limiting for serverless environments.
// ============================================================

class RateLimiter {
    /**
     * @param {Object} opts
     * @param {number} [opts.maxRequests=20] - Max requests per window
     * @param {number} [opts.windowMs=60000] - Window size in ms
     * @param {number} [opts.cleanupIntervalMs=300000] - Cleanup interval
     */
    constructor(opts = {}) {
        this.maxRequests = opts.maxRequests || 20;
        this.windowMs = opts.windowMs || 60000;
        this.cleanupIntervalMs = opts.cleanupIntervalMs || 300000;
        this.buckets = new Map();

        // Periodic cleanup to prevent unbounded growth in long-running processes
        this._cleanupTimer = setInterval(() => this._cleanup(), this.cleanupIntervalMs);
        this._cleanupTimer.unref(); // Don't prevent process exit
    }

    /**
     * Check if a request should be allowed.
     * @param {string} key - Typically IP address or IP+route
     * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
     */
    check(key) {
        const now = Date.now();
        let bucket = this.buckets.get(key);

        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + this.windowMs };
            this.buckets.set(key, bucket);
        }

        bucket.count++;
        const remaining = Math.max(0, this.maxRequests - bucket.count);

        return {
            allowed: bucket.count <= this.maxRequests,
            remaining,
            resetAt: bucket.resetAt,
        };
    }

    /**
     * Get rate limit headers for a check result.
     * @param {{ remaining: number, resetAt: number }} result
     * @returns {Object}
     */
    static headers(result) {
        const resetSeconds = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
        return {
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(resetSeconds),
        };
    }

    /** @private */
    _cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this.buckets) {
            if (now > bucket.resetAt) {
                this.buckets.delete(key);
            }
        }
    }
}

/**
 * Validate that a slug contains only safe characters.
 * Prevents URL path traversal and injection via crafted country names.
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
    return typeof slug === 'string' && /^[a-z0-9_-]+$/.test(slug) && slug.length <= 100;
}

/**
 * Validate a TMDB API key format (basic sanity check).
 * @param {string} key
 * @returns {boolean}
 */
function isValidApiKeyFormat(key) {
    if (typeof key !== 'string') return false;
    const trimmed = key.trim();
    // TMDB v3 keys: 32 hex chars; v4 bearer tokens: longer
    return trimmed.length >= 20 && trimmed.length <= 200 && /^[a-zA-Z0-9_\-]+$/.test(trimmed);
}

/**
 * Sanitize a string to only allow alphanumeric, dash, underscore, space.
 * Used for type overrides (movieType, seriesType) to prevent injection into manifests.
 * @param {string} str
 * @returns {string}
 */
function sanitizeTypeString(str) {
    if (typeof str !== 'string') return '';
    const trimmed = str.trim();
    // Only allow alphanumeric, spaces, hyphens, underscores (max 50 chars)
    const sanitized = trimmed.replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 50);
    return sanitized.trim() || '';
}

module.exports = {
    fetchWithTimeout,
    pMap,
    getFlixPatrolSlug,
    toIdSlug,
    escapeHtml,
    escapeJs,
    generateToken,
    RateLimiter,
    isValidSlug,
    isValidApiKeyFormat,
    sanitizeTypeString,
};
