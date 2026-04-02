// ============================================================
// Tests: LRU Cache
// Fixes PERF-02: Verifies proper LRU eviction behavior
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { LRUCache } from '../lib/cache.js';

describe('LRUCache', () => {
    it('should store and retrieve values', () => {
        const cache = new LRUCache({ maxSize: 10, ttl: 60000 });
        cache.set('key1', 'value1');
        const result = cache.get('key1');
        expect(result.data).toBe('value1');
        expect(result.stale).toBe(false);
        expect(result.hit).toBe(true);
    });

    it('should return null for missing keys', () => {
        const cache = new LRUCache({ maxSize: 10, ttl: 60000 });
        const result = cache.get('nonexistent');
        expect(result.data).toBeNull();
        expect(result.hit).toBe(false);
    });

    it('should evict LRU entries when maxSize is exceeded', () => {
        const cache = new LRUCache({ maxSize: 3, ttl: 0 }); // no TTL for this test
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // All three should be present
        expect(cache.get('a').data).toBe(1);
        expect(cache.get('b').data).toBe(2);
        expect(cache.get('c').data).toBe(3);

        // Adding a 4th entry should evict 'a' (least recently used)
        cache.set('d', 4);
        expect(cache.get('a').data).toBeNull(); // evicted
        expect(cache.get('d').data).toBe(4);
        expect(cache.size).toBe(3);
    });

    it('should reorder on get (access order = LRU)', () => {
        const cache = new LRUCache({ maxSize: 3, ttl: 0 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Access 'a' to make it most recently used
        cache.get('a');

        // Now add 'd' — should evict 'b' (not 'a')
        cache.set('d', 4);
        expect(cache.get('a').data).toBe(1); // still present (was accessed)
        expect(cache.get('b').data).toBeNull(); // evicted (was LRU)
        expect(cache.get('c').data).toBe(3);
        expect(cache.get('d').data).toBe(4);
    });

    it('should respect TTL and return stale data', () => {
        vi.useFakeTimers();
        const cache = new LRUCache({ maxSize: 10, ttl: 1000 });

        cache.set('key1', 'value1');
        expect(cache.get('key1').data).toBe('value1');

        // Advance past TTL
        vi.advanceTimersByTime(1500);
        const result = cache.get('key1');
        expect(result.data).toBeNull();
        expect(result.expired).toBe(true);

        vi.useRealTimers();
    });

    it('should support stale-while-revalidate pattern', () => {
        vi.useFakeTimers();
        const cache = new LRUCache({ maxSize: 10, ttl: 1000 });

        cache.set('key1', 'old_value');
        expect(cache.getStale('key1').data).toBe('old_value');
        expect(cache.getStale('key1').stale).toBe(false);

        // Advance past TTL
        vi.advanceTimersByTime(1500);
        const stale = cache.getStale('key1');
        expect(stale.data).toBe('old_value');
        expect(stale.stale).toBe(true);

        vi.useRealTimers();
    });

    it('should support peek without reordering', () => {
        const cache = new LRUCache({ maxSize: 3, ttl: 0 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Peek at 'a' without reordering
        expect(cache.peek('a')).toBe(1);

        // Add 'd' — 'a' should still be evicted since peek doesn't reorder
        cache.set('d', 4);
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('b')).toBe(2);
    });

    it('should handle delete and clear', () => {
        const cache = new LRUCache({ maxSize: 10, ttl: 0 });
        cache.set('a', 1);
        cache.set('b', 2);

        expect(cache.delete('a')).toBe(true);
        expect(cache.get('a').data).toBeNull();
        expect(cache.size).toBe(1);

        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.get('b').data).toBeNull();
    });
});
