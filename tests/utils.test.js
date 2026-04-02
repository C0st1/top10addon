// ============================================================
// Tests: Utility Functions
// ============================================================

import { describe, it, expect } from 'vitest';
import { getFlixPatrolSlug, toIdSlug, escapeHtml, escapeJs, generateToken } from '../lib/utils.js';

describe('getFlixPatrolSlug', () => {
    it('should return "world" for null/undefined', () => {
        expect(getFlixPatrolSlug(null)).toBe('world');
        expect(getFlixPatrolSlug(undefined)).toBe('world');
    });

    it('should return "world" for Global/Worldwide', () => {
        expect(getFlixPatrolSlug('Global')).toBe('world');
        expect(getFlixPatrolSlug('global')).toBe('world');
        expect(getFlixPatrolSlug('Worldwide')).toBe('world');
    });

    it('should convert country names to slugs', () => {
        expect(getFlixPatrolSlug('United States')).toBe('united-states');
        expect(getFlixPatrolSlug('South Korea')).toBe('south-korea');
        expect(getFlixPatrolSlug('New Zealand')).toBe('new-zealand');
    });

    it('should strip special characters', () => {
        expect(getFlixPatrolSlug('Trinidad and Tobago')).toBe('trinidad-and-tobago');
    });
});

describe('toIdSlug', () => {
    it('should convert country names to underscore slugs', () => {
        expect(toIdSlug('United States')).toBe('united_states');
        expect(toIdSlug('Global')).toBe('global');
        expect(toIdSlug('South Africa')).toBe('south_africa');
    });
});

describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('should escape ampersands', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape single quotes', () => {
        expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('should handle non-string inputs', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(123)).toBe('');
    });
});

describe('escapeJs', () => {
    it('should escape JavaScript string literals', () => {
        expect(escapeJs('hello"world')).toBe('hello\\"world');
        expect(escapeJs("it's")).toBe("it\\'s");
    });

    it('should escape angle brackets', () => {
        expect(escapeJs('<div>')).toBe('\\x3cdiv\\x3e');
    });
});

describe('generateToken', () => {
    it('should generate a 24-character token', () => {
        const token = generateToken();
        expect(token).toHaveLength(24);
    });

    it('should generate unique tokens', () => {
        const tokens = new Set();
        for (let i = 0; i < 100; i++) {
            tokens.add(generateToken());
        }
        expect(tokens.size).toBe(100);
    });

    it('should only contain alphanumeric characters', () => {
        const token = generateToken();
        expect(token).toMatch(/^[A-Za-z0-9]+$/);
    });
});
