// ============================================================
// Tests: Config Store
// Fixes SEC-02: Verifies opaque token-based config storage
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { saveConfig, getConfig, parseConfig, normalizeConfig } from '../lib/config-store.js';

describe('Config Store', () => {
    beforeEach(() => {
        // Reset internal state between tests by importing fresh
        // Note: In production, the cache is a module singleton
    });

    describe('saveConfig', () => {
        it('should save config and return a token', () => {
            const result = saveConfig(
                {
                    tmdbApiKey: 'test-key-123',
                    country: 'Global',
                },
                'https://example.com',
            );

            expect(result.token).toBeDefined();
            expect(result.token).toHaveLength(24);
            expect(result.manifestUrl).toMatch(/\/\w+\/manifest\.json$/);
            expect(result.installUrl).toMatch(/^stremio:\/\//);
        });

        it('should store config retrievable by token', () => {
            const result = saveConfig(
                {
                    tmdbApiKey: 'my-secret-key',
                    rpdbApiKey: 'rpdb-key',
                    country: 'Japan,Brazil',
                    movieType: 'films',
                },
                'https://example.com',
            );

            const config = getConfig(result.token);
            expect(config!.tmdbApiKey).toBe('my-secret-key');
            expect(config!.rpdbApiKey).toBe('rpdb-key');
            expect(config!.country).toBe('Japan,Brazil');
            expect(config!.movieType).toBe('films');
        });

        it('should NOT expose API key in the token', () => {
            const result = saveConfig(
                {
                    tmdbApiKey: 'super-secret-key-12345',
                    country: 'Global',
                },
                'https://example.com',
            );

            // Token should NOT contain the API key
            expect(result.token).not.toContain('super-secret');
            expect(result.token).not.toContain('secret');
            // Token should be a simple alphanumeric string
            expect(result.token).toMatch(/^[A-Za-z0-9]+$/);
        });
    });

    describe('getConfig', () => {
        it('should return null for non-existent tokens', () => {
            const config = getConfig('nonexistent-token-12345678');
            expect(config).toBeNull();
        });
    });

    describe('parseConfig (legacy backward compat)', () => {
        it('should parse a valid legacy config string', () => {
            const config = {
                tmdbApiKey: 'test-key',
                country: 'Japan,Brazil',
                movieType: 'films',
                seriesType: 'tvshows',
            };
            const encoded = encodeURIComponent(JSON.stringify(config));
            const result = parseConfig(encoded);

            expect(result!.tmdbApiKey).toBe('test-key');
            expect(result!.multiCountries).toEqual(['Japan', 'Brazil']);
            expect(result!.movieType).toBe('films');
            expect(result!.seriesType).toBe('tvshows');
        });

        it('should return null for empty API key', () => {
            const config = { tmdbApiKey: '', country: 'Global' };
            const encoded = encodeURIComponent(JSON.stringify(config));
            expect(parseConfig(encoded)).toBeNull();
        });

        it('should return null for invalid JSON', () => {
            expect(parseConfig('not-json')).toBeNull();
        });

        it('should default to Global when no country specified', () => {
            const config = { tmdbApiKey: 'key' };
            const encoded = encodeURIComponent(JSON.stringify(config));
            const result = parseConfig(encoded);
            expect(result!.country).toBe('Global');
            expect(result!.multiCountries).toEqual(['Global']);
        });
    });

    describe('normalizeConfig', () => {
        it('should normalize a raw config object', () => {
            const result = normalizeConfig({
                tmdbApiKey: '  key123  ',
                rpdbApiKey: '  rpdb  ',
                country: ' Japan , Brazil ',
                movieType: ' films ',
                seriesType: '  ',
            });

            expect(result!.tmdbApiKey).toBe('key123');
            expect(result!.rpdbApiKey).toBe('rpdb');
            expect(result!.multiCountries).toEqual(['Japan', 'Brazil']);
            expect(result!.country).toBe('Japan');
            expect(result!.movieType).toBe('films');
            expect(result!.seriesType).toBe('series'); // defaults
        });

        it('should return null for missing API key', () => {
            expect(normalizeConfig({})).toBeNull();
            expect(normalizeConfig(null)).toBeNull();
            expect(normalizeConfig({ tmdbApiKey: '  ' })).toBeNull();
        });
    });
});
