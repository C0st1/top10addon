// ============================================================
// Tests: TMDB Module
// ============================================================

import { describe, it, expect } from 'vitest';
import { formatMeta, getRpdbPosterUrl } from '../lib/tmdb.js';

describe('formatMeta', () => {
    it('should format a movie meta object correctly', () => {
        const item = {
            id: 12345,
            title: 'Test Movie',
            poster_path: '/abc.jpg',
            backdrop_path: '/def.jpg',
            overview: 'A test movie',
            release_date: '2024-01-15'
        };

        const meta = formatMeta(item, 'tt1234567', 'movie');
        expect(meta.id).toBe('tt1234567');
        expect(meta.type).toBe('movie');
        expect(meta.name).toBe('Test Movie');
        expect(meta.tmdbPoster).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
        expect(meta.background).toBe('https://image.tmdb.org/t/p/w1280/def.jpg');
        expect(meta.description).toBe('A test movie');
        expect(meta.releaseInfo).toBe('2024');
    });

    it('should format a TV series meta object correctly', () => {
        const item = {
            id: 67890,
            name: 'Test Show',
            poster_path: '/xyz.jpg',
            backdrop_path: null,
            overview: '',
            first_air_date: '2023-06-20'
        };

        const meta = formatMeta(item, 'tt9876543', 'tv');
        expect(meta.id).toBe('tt9876543');
        expect(meta.type).toBe('series');
        expect(meta.name).toBe('Test Show');
        expect(meta.tmdbPoster).toBe('https://image.tmdb.org/t/p/w500/xyz.jpg');
        expect(meta.background).toBeNull();
        expect(meta.description).toBe('');
        expect(meta.releaseInfo).toBe('2023');
    });

    it('should handle null poster/backdrop paths', () => {
        const item = {
            id: 1,
            title: 'No Art',
            poster_path: null,
            backdrop_path: null,
            overview: 'desc'
        };

        const meta = formatMeta(item, 'tmdb:1', 'movie');
        expect(meta.tmdbPoster).toBeNull();
        expect(meta.background).toBeNull();
    });

    it('should handle missing release date', () => {
        const item = {
            id: 1,
            title: 'No Date',
            poster_path: null,
            overview: ''
        };

        const meta = formatMeta(item, 'tmdb:1', 'movie');
        expect(meta.releaseInfo).toBe('');
    });
});

describe('getRpdbPosterUrl', () => {
    it('should return RPDB poster URL for valid inputs', () => {
        const url = getRpdbPosterUrl('tt1234567', 'rpdb-key');
        expect(url).toBe('https://api.ratingposterdb.com/rpdb-key/imdb/poster-default/tt1234567.jpg');
    });

    it('should return null when rpdbApiKey is missing', () => {
        expect(getRpdbPosterUrl('tt1234567', null)).toBeNull();
        expect(getRpdbPosterUrl('tt1234567', '')).toBeNull();
    });

    it('should return null when imdbId is invalid', () => {
        expect(getRpdbPosterUrl('not-imdb', 'rpdb-key')).toBeNull();
        expect(getRpdbPosterUrl('tmdb:12345', 'rpdb-key')).toBeNull();
        expect(getRpdbPosterUrl(null, 'rpdb-key')).toBeNull();
    });
});
