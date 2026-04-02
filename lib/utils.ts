// ============================================================
// Utility Functions — shared helpers
// ============================================================

export interface FetchOptions extends RequestInit {
    timeout?: number;
}

/**
 * Fetch with abort timeout.
 */
export async function fetchWithTimeout(url: string, opts: FetchOptions = {}, ms: number = 8000): Promise<Response> {
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
 */
export async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number = 5): Promise<R[]> {
    const results: Promise<R>[] = [];
    const executing = new Set<Promise<R>>();
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
 */
export function getFlixPatrolSlug(country: string | null | undefined): string {
    if (!country) return 'world';
    const lower = country.toLowerCase();
    if (lower === 'global' || lower === 'worldwide') return 'world';
    return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Convert country name to catalog ID slug.
 */
export function toIdSlug(c: string): string {
    return c.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Escape HTML entities to prevent XSS.
 */
export function escapeHtml(str: unknown): string {
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
 */
export function escapeJs(str: unknown): string {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e');
}

/**
 * Generate a simple unique token for config storage.
 */
export function generateToken(): string {
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
