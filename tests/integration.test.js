// ============================================================
// Tests: Integration Tests
// Tests the full request flow without external dependencies
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies
const originalFetch = global.fetch;

describe('Integration Tests', () => {
    let handler;

    beforeEach(async () => {
        vi.resetModules();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    describe('Health Check Endpoint', () => {
        it('should return healthy status', async () => {
            // Import fresh handler
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/health',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: expect.stringMatching(/^(ok|degraded)$/),
                type: 'flixpatrol_scraper',
                version: expect.any(String),
            }));
        });

        it('should include rate limit information', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/health',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            const jsonCall = res.json.mock.calls[0][0];
            expect(jsonCall.rateLimits).toBeDefined();
            expect(jsonCall.rateLimits.api).toBeDefined();
            expect(jsonCall.rateLimits.catalog).toBeDefined();
        });
    });

    describe('Metrics Endpoint', () => {
        it('should return Prometheus-compatible metrics', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/metrics',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4');
        });
    });

    describe('Configuration Page', () => {
        it('should return HTML for root path', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html;charset=UTF-8');
        });

        it('should return HTML for /configure path', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/configure',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalled();
            const html = res.send.mock.calls[0][0];
            expect(html).toContain('<!DOCTYPE html>');
        });
    });

    describe('CORS Preflight', () => {
        it('should handle OPTIONS requests', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'OPTIONS',
                url: '/any-path',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                end: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Max-Age', '86400');
        });
    });

    describe('Save Config Endpoint', () => {
        it('should reject missing API key', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'POST',
                url: '/api/save-config',
                headers: { host: 'localhost:3000' },
                body: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('API key'),
            }));
        });

        it('should reject invalid API key format', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'POST',
                url: '/api/save-config',
                headers: { host: 'localhost:3000' },
                body: { tmdbApiKey: 'short' },
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining('Invalid'),
            }));
        });

        it('should save valid configuration', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'POST',
                url: '/api/save-config',
                headers: {
                    host: 'localhost:3000',
                    'x-forwarded-proto': 'https',
                },
                body: {
                    tmdbApiKey: 'validapikey12345678901234567890',
                    country: 'Global',
                },
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                token: expect.any(String),
                manifestUrl: expect.any(String),
                installUrl: expect.any(String),
            }));
        });
    });

    describe('Manifest Endpoint', () => {
        it('should reject invalid token format', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/invalid-token/manifest.json',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Invalid token format',
            }));
        });

        it('should return 404 for non-existent token', async () => {
            handler = (await import('../api/index.js')).default;

            const validToken = 'A'.repeat(32); // 32 char alphanumeric token

            const req = {
                method: 'GET',
                url: `/${validToken}/manifest.json`,
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('Request ID', () => {
        it('should include request ID in response headers', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            // Check that X-Request-Id was set
            const requestIdCalls = res.setHeader.mock.calls.filter(
                call => call[0] === 'X-Request-Id'
            );
            expect(requestIdCalls.length).toBeGreaterThan(0);
            expect(requestIdCalls[0][1]).toMatch(/^[A-Za-z0-9]+$/);
        });
    });

    describe('Security Headers', () => {
        it('should set security headers on all responses', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/health',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            const headerNames = res.setHeader.mock.calls.map(call => call[0]);
            expect(headerNames).toContain('X-Content-Type-Options');
            expect(headerNames).toContain('X-Frame-Options');
            expect(headerNames).toContain('X-XSS-Protection');
        });
    });

    describe('404 Handler', () => {
        it('should return 404 for unknown paths', async () => {
            handler = (await import('../api/index.js')).default;

            const req = {
                method: 'GET',
                url: '/unknown-path-12345',
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
            };

            const res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                headers: {},
            };
            res.req = req;

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.send).toHaveBeenCalledWith('Not Found');
        });
    });
});
