// ============================================================
// LRU Cache Implementation — replaces FIFO Map-based cache
// Fixes PERF-02: Inefficient cache eviction strategy
// ============================================================

class LRUCache {
    /**
     * @param {Object} opts
     * @param {number} [opts.maxSize=2000] - Maximum number of entries
     * @param {number} [opts.ttl=3600000] - Default TTL in ms (0 = no expiry)
     */
    constructor(opts = {}) {
        this.maxSize = opts.maxSize || 2000;
        this.ttl = opts.ttl !== undefined ? opts.ttl : 3600000;
        this.cache = new Map(); // insertion order = access order (we reorder on get)
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return { data: null, stale: false, hit: false };

        const now = Date.now();
        const isExpired = this.ttl > 0 && (now - entry.timestamp > this.ttl);
        const isStale = this.ttl > 0 && (now - entry.timestamp > this.ttl);

        if (isExpired) {
            this.cache.delete(key);
            return { data: null, stale: false, hit: true, expired: true };
        }

        // LRU: move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { data: entry.data, stale: false, hit: true };
    }

    /**
     * Get with stale-while-revalidate semantics.
     * Returns stale data if available, along with a boolean indicating staleness.
     */
    getStale(key) {
        const entry = this.cache.get(key);
        if (!entry) return { data: null, stale: false };

        const now = Date.now();
        const isStale = this.ttl > 0 && (now - entry.timestamp > this.ttl);

        if (isStale) {
            // Don't delete — return stale data for SWR pattern
            return { data: entry.data, stale: true };
        }

        // LRU: reorder
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { data: entry.data, stale: false };
    }

    set(key, data) {
        // If key exists, delete first to reorder
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, { data, timestamp: Date.now() });

        // Evict least recently used (first entry in Map)
        while (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    get size() {
        return this.cache.size;
    }

    clear() {
        this.cache.clear();
    }

    /**
     * Get raw value without reordering (for in-flight checks)
     */
    peek(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        const now = Date.now();
        if (this.ttl > 0 && (now - entry.timestamp > this.ttl)) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.data;
    }
}

module.exports = { LRUCache };
