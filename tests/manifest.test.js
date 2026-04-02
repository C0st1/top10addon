// ============================================================
// Tests: Manifest Builder
// Fixes CQ-01: Verifies no duplicate condition checks
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildManifest } from '../lib/manifest.js';

describe('buildManifest', () => {
    it('should build a basic manifest for Global', () => {
        const manifest = buildManifest();
        expect(manifest.id).toBe('org.stremio.netflixtop10');
        expect(manifest.version).toBeDefined();
        expect(manifest.name).toBe('Netflix Top 10');
        expect(manifest.catalogs).toHaveLength(2);
        expect(manifest.types).toContain('movie');
        expect(manifest.types).toContain('series');
    });

    it('should create separate catalogs per country', () => {
        const manifest = buildManifest('Global', ['Global', 'Japan', 'Brazil']);
        expect(manifest.catalogs).toHaveLength(6); // 2 per country
        expect(manifest.catalogs[0].id).toBe('netflix_top10_movies_global');
        expect(manifest.catalogs[2].id).toBe('netflix_top10_movies_japan');
        expect(manifest.catalogs[4].id).toBe('netflix_top10_movies_brazil');
    });

    it('should use custom type overrides', () => {
        const manifest = buildManifest('Global', [], 'films', 'tvshows');
        expect(manifest.catalogs[0].type).toBe('films');
        expect(manifest.catalogs[1].type).toBe('tvshows');
        expect(manifest.types).toContain('films');
        expect(manifest.types).toContain('tvshows');
    });

    it('should handle single country (non-Global)', () => {
        const manifest = buildManifest('Japan');
        expect(manifest.catalogs).toHaveLength(2);
        expect(manifest.catalogs[0].id).toContain('japan');
        expect(manifest.catalogs[0].name).toContain('Japan');
    });

    it('should deduplicate types', () => {
        const manifest = buildManifest('Global', [], 'movie', 'movie');
        expect(manifest.types).toHaveLength(1);
        expect(manifest.types[0]).toBe('movie');
    });

    it('should include required Stremio fields', () => {
        const manifest = buildManifest();
        expect(manifest.resources).toEqual(['catalog']);
        expect(manifest.behaviorHints).toEqual({ configurable: true });
        expect(manifest.logo).toBeDefined();
        expect(manifest.config).toBeDefined();
    });
});
