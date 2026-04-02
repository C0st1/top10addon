// ============================================================
// Config Store — Opaque token-based configuration storage
// Fixes SEC-02: API keys no longer embedded in URLs
// ============================================================

import { LRUCache } from './cache.js';
import { generateToken } from './utils.js';
import { DEFAULTS } from './constants.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'config-store' });

export interface UserConfig {
    tmdbApiKey: string;
    rpdbApiKey?: string;
    country: string;
    movieType?: string;
    seriesType?: string;
}

export interface StoredConfig extends UserConfig {
    createdAt: number;
}

export interface NormalizedConfig {
    tmdbApiKey: string;
    rpdbApiKey: string | null;
    country: string;
    multiCountries: string[];
    movieType: string;
    seriesType: string;
}

export interface ConfigResult {
    token: string;
    manifestUrl: string;
    installUrl: string;
}

// LRU cache for config tokens
const configStore = new LRUCache<StoredConfig>({
    maxSize: DEFAULTS.CONFIG_STORE_MAX,
    ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
});

/**
 * Save a configuration and return an opaque token.
 * The token can be used in manifest/catalog URLs without exposing credentials.
 */
export function saveConfig(config: UserConfig, baseUrl: string): ConfigResult {
    const token = generateToken();
    configStore.set(token, {
        ...config,
        createdAt: Date.now(),
    });
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const manifestUrl = `${cleanBase}/${token}/manifest.json`;
    const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
    return { token, manifestUrl, installUrl };
}

/**
 * Look up configuration by opaque token.
 */
export function getConfig(token: string): StoredConfig | null {
    const result = configStore.get(token);
    return result.data;
}

/**
 * Parse a legacy encoded config from URL (backward compatibility).
 */
export function parseConfig(configStr: string): NormalizedConfig | null {
    try {
        const config = JSON.parse(decodeURIComponent(configStr)) as Partial<UserConfig>;
        if (!config?.tmdbApiKey?.trim()) return null;
        const mc = (config.country || 'Global')
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c);
        return {
            tmdbApiKey: config.tmdbApiKey!.trim(),
            rpdbApiKey: config.rpdbApiKey?.trim() || null,
            country: mc[0] || 'Global',
            multiCountries: mc,
            movieType: config.movieType ? config.movieType.trim() : 'movie',
            seriesType: config.seriesType ? config.seriesType.trim() : 'series',
        };
    } catch (err) {
        log.warn({ err: err as Error }, 'Failed to parse config string');
        return null;
    }
}

/**
 * Normalize a config object (from store or parsed) to a standard shape.
 */
export function normalizeConfig(config: Partial<StoredConfig> | null): NormalizedConfig | null {
    if (!config?.tmdbApiKey?.trim()) return null;
    const mc = (config.country || 'Global')
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c);
    return {
        tmdbApiKey: config.tmdbApiKey!.trim(),
        rpdbApiKey: config.rpdbApiKey?.trim() || null,
        country: mc[0] || 'Global',
        multiCountries: mc,
        movieType: (config.movieType ? config.movieType.trim() : '') || 'movie',
        seriesType: (config.seriesType ? config.seriesType.trim() : '') || 'series',
    };
}
