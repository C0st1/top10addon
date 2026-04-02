// ============================================================
// LRU Cache Implementation — replaces FIFO Map-based cache
// Fixes PERF-02: Inefficient cache eviction strategy
// ============================================================

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export interface CacheResult<T> {
    data: T | null;
    stale: boolean;
    hit?: boolean;
    expired?: boolean;
}

export interface LRUCacheOptions {
    maxSize?: number;
    ttl?: number;
}

export class LRUCache<T = unknown> {
    private maxSize: number;
    private ttl: number;
    private cache: Map<string, CacheEntry<T>>;

    /**
     * @param opts - Cache configuration options
     * @param opts.maxSize - Maximum number of entries (default: 2000)
     * @param opts.ttl - Default TTL in ms (0 = no expiry, default: 3600000)
     */
    constructor(opts: LRUCacheOptions = {}) {
        this.maxSize = opts.maxSize || 2000;
        this.ttl = opts.ttl !== undefined ? opts.ttl : 3600000;
        this.cache = new Map(); // insertion order = access order (we reorder on get)
    }

    get(key: string): CacheResult<T> {
        const entry = this.cache.get(key);
        if (!entry) return { data: null, stale: false, hit: false };

        const now = Date.now();
        const isExpired = this.ttl > 0 && now - entry.timestamp > this.ttl;

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
    getStale(key: string): CacheResult<T> {
        const entry = this.cache.get(key);
        if (!entry) return { data: null, stale: false };

        const now = Date.now();
        const isStale = this.ttl > 0 && now - entry.timestamp > this.ttl;

        if (isStale) {
            // Don't delete — return stale data for SWR pattern
            return { data: entry.data, stale: true };
        }

        // LRU: reorder
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { data: entry.data, stale: false };
    }

    set(key: string, data: T): void {
        // If key exists, delete first to reorder
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, { data, timestamp: Date.now() });

        // Evict least recently used (first entry in Map)
        while (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value as string;
            this.cache.delete(firstKey);
        }
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
    }

    /**
     * Get raw value without reordering (for in-flight checks)
     */
    peek(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        const now = Date.now();
        if (this.ttl > 0 && now - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.data;
    }
}
