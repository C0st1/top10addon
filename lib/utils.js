// ============================================================
// Utility Functions — shared helpers
// ============================================================

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
    return c.toLowerCase().replace(/[^a-z0-9]+/g, "_");
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
 * Escape string for safe inclusion in a JavaScript string literal.
 * @param {string} str
 * @returns {string}
 */
function escapeJs(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
}

/**
 * Generate a simple unique token for config storage.
 * @returns {string}
 */
function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(24);
    // Use crypto if available (Node.js 18+)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < randomValues.length; i++) {
            result += chars[randomValues[i] % chars.length];
        }
    } else {
        for (let i = 0; i < 24; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
    }
    return result;
}

module.exports = {
    fetchWithTimeout,
    pMap,
    getFlixPatrolSlug,
    toIdSlug,
    escapeHtml,
    escapeJs,
    generateToken,
};
