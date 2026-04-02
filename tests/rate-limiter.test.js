// ============================================================
// Tests: Rate Limiter
// Tests the sliding-window rate limiter implementation
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../lib/utils.js';

describe('RateLimiter', () => {
    let limiter;

    beforeEach(() => {
        limiter = new RateLimiter({
            maxRequests: 5,
            windowMs: 1000, // 1 second window for tests
            cleanupIntervalMs: 100 // Fast cleanup for tests
        });
    });

    afterEach(() => {
        clearInterval(limiter._cleanupTimer);
    });

    describe('check', () => {
        it('should allow requests within limit', () => {
            for (let i = 0; i < 5; i++) {
                const result = limiter.check('user1');
                expect(result.allowed).toBe(true);
                expect(result.remaining).toBe(4 - i);
            }
        });

        it('should block requests exceeding limit', () => {
            // Use up all allowed requests
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }

            // Next request should be blocked
            const result = limiter.check('user1');
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should track different keys independently', () => {
            // Use up limit for user1
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }
            expect(limiter.check('user1').allowed).toBe(false);

            // user2 should still be allowed
            const result = limiter.check('user2');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4);
        });

        it('should reset after window expires', async () => {
            // Use up all requests
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }
            expect(limiter.check('user1').allowed).toBe(false);

            // Wait for window to expire
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Should be allowed again
            const result = limiter.check('user1');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4);
        });

        it('should return resetAt timestamp', () => {
            const before = Date.now();
            const result = limiter.check('user1');
            const after = Date.now();

            expect(result.resetAt).toBeGreaterThanOrEqual(before + 1000);
            expect(result.resetAt).toBeLessThanOrEqual(after + 1000);
        });
    });

    describe('headers', () => {
        it('should generate rate limit headers', () => {
            const result = limiter.check('user1');
            const headers = RateLimiter.headers(result);

            expect(headers['X-RateLimit-Remaining']).toBeDefined();
            expect(headers['X-RateLimit-Reset']).toBeDefined();
            expect(parseInt(headers['X-RateLimit-Remaining'])).toBe(4);
        });

        it('should show remaining count decreasing', () => {
            for (let i = 0; i < 3; i++) {
                limiter.check('user1');
            }
            const result = limiter.check('user1');
            const headers = RateLimiter.headers(result);

            expect(parseInt(headers['X-RateLimit-Remaining'])).toBe(1);
        });

        it('should show zero remaining when blocked', () => {
            for (let i = 0; i < 5; i++) {
                limiter.check('user1');
            }
            const result = limiter.check('user1');
            const headers = RateLimiter.headers(result);

            expect(parseInt(headers['X-RateLimit-Remaining'])).toBe(0);
        });
    });

    describe('_cleanup', () => {
        it('should remove expired buckets', async () => {
            // Create a bucket
            limiter.check('user1');

            // Wait for window to expire
            await new Promise(resolve => setTimeout(resolve, 1100));

            // Trigger cleanup
            limiter._cleanup();

            // Bucket should be removed
            expect(limiter.buckets.has('user1')).toBe(false);
        });

        it('should keep active buckets', () => {
            // Create a bucket
            limiter.check('user1');

            // Trigger cleanup immediately (bucket should still be valid)
            limiter._cleanup();

            // Bucket should still exist
            expect(limiter.buckets.has('user1')).toBe(true);
        });
    });

    describe('default configuration', () => {
        it('should use default values when not specified', () => {
            const defaultLimiter = new RateLimiter();
            expect(defaultLimiter.maxRequests).toBe(20);
            expect(defaultLimiter.windowMs).toBe(60000);
            clearInterval(defaultLimiter._cleanupTimer);
        });
    });
});
