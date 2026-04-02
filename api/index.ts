// ============================================================
// Vercel / Node.js Server — Netflix Top 10 Stremio Addon v4.0.0
// ARCH-01 FIX: Thin routing layer; logic in lib/ modules
// SEC-HARDEN: Security headers, rate limiting, Zod validation, CSRF, structured logging
// ============================================================

import { buildConfigHTML } from '../lib/template.js';
import { fetchFlixPatrolTitles, getAvailableCountries } from '../lib/scraper.js';
import { buildManifest, buildCatalog } from '../lib/manifest.js';
import { validateTmdbKey } from '../lib/tmdb.js';
import {
    saveConfig,
    getConfig,
    parseConfig,
    normalizeConfig,
    NormalizedConfig,
} from '../lib/config-store.js';
import { toIdSlug } from '../lib/utils.js';
import { VERSION } from '../lib/constants.js';
import { logger } from '../lib/logger.js';
import {
    securityHeaders,
    cspHeaderValue,
    isSameOrigin,
    rateLimitSaveConfig,
    rateLimitValidateKey,
    rateLimitCatalog,
} from '../lib/security.js';
import { saveConfigSchema, validateTmdbKeySchema } from '../lib/validation.js';
import { generateRSSFeed } from '../lib/feed.js';
import { getHealthReport } from '../lib/health.js';

// Module-level child logger for API handler
const log = logger.child({ module: 'api' });

interface VercelRequest {
    method?: string;
    url?: string;
    headers?: Record<string, string | undefined>;
    body?: unknown;
    ip?: string;
}

interface VercelResponse {
    status(code: number): VercelResponse;
    setHeader(name: string, value: string): VercelResponse;
    json(data: unknown): VercelResponse;
    send(body: string): VercelResponse;
    end(): VercelResponse;
}

/**
 * Apply security headers to all responses.
 */
function applySecurityHeaders(res: VercelResponse): void {
    for (const [key, value] of Object.entries(securityHeaders)) {
        res.setHeader(key, value);
    }
}

/**
 * Parse request body from Vercel request object.
 */
async function parseBody(req: VercelRequest): Promise<Record<string, unknown>> {
    if (req.body) {
        return typeof req.body === 'string'
            ? JSON.parse(req.body)
            : (req.body as Record<string, unknown>);
    }
    try {
        const bufs: Buffer[] = [];
        let length = 0;
        for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
            bufs.push(chunk);
            length += chunk.length;
            if (length > 1e5) break;
        }
        return JSON.parse(Buffer.concat(bufs).toString());
    } catch (e) {
        throw new Error(`Failed to parse request body: ${(e as Error).message}`);
    }
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse,
): Promise<VercelResponse> {
    // Apply security headers to ALL responses
    applySecurityHeaders(res);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(200).end();
    }

    // Normalize path
    let path = req.url || '/';
    if (path.startsWith('/api/index.js') || path.startsWith('/api/index.ts')) {
        path = path.replace(/\/api\/index\.(js|ts)/, '');
    }
    if (path === '') path = '/';

    // Strip query string for routing
    const pathWithoutQuery = path.split('?')[0];

    // -----------------------------------------------
    // Configuration page (HTML — needs CSP header)
    // -----------------------------------------------
    if (pathWithoutQuery === '/' || pathWithoutQuery === '/configure') {
        const countries = getAvailableCountries();
        res.setHeader('Content-Security-Policy', cspHeaderValue);
        return res.status(200)
            .setHeader('Content-Type', 'text/html;charset=UTF-8')
            .send(buildConfigHTML(countries));
    }

    // -----------------------------------------------
    // Health check (enhanced with memory & uptime)
    // -----------------------------------------------
    if (pathWithoutQuery === '/health') {
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).json(getHealthReport());
    }

    // -----------------------------------------------
    // API: Validate TMDB key (rate-limited, CSRF-checked, Zod-validated)
    // -----------------------------------------------
    if (pathWithoutQuery === '/api/validate-tmdb-key' && req.method === 'POST') {
        // Rate limiting
        if (!await rateLimitValidateKey(req)) {
            log.warn({ path: '/api/validate-tmdb-key' }, 'Rate limit exceeded');
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }

        // CSRF check
        if (!isSameOrigin(req)) {
            log.warn({ path: '/api/validate-tmdb-key' }, 'CSRF check failed');
            return res.status(403).json({ error: 'Forbidden: cross-origin request rejected.' });
        }

        let body: Record<string, unknown>;
        try {
            body = await parseBody(req);
        } catch (e) {
            log.warn({ err: e as Error, path: '/api/validate-tmdb-key' }, 'Failed to parse request body');
            return res.status(400).json({ error: 'Invalid request body' });
        }

        // Zod validation
        const parsed = validateTmdbKeySchema.safeParse(body);
        if (!parsed.success) {
            log.warn({ errors: parsed.error.flatten().fieldErrors, path: '/api/validate-tmdb-key' }, 'Validation failed');
            return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
        }

        return res.status(200).json(await validateTmdbKey(parsed.data.apiKey));
    }

    // -----------------------------------------------
    // API: Save config (rate-limited, CSRF-checked, Zod-validated)
    // SEC-02 FIX — opaque tokens
    // -----------------------------------------------
    if (pathWithoutQuery === '/api/save-config' && req.method === 'POST') {
        // Rate limiting
        if (!await rateLimitSaveConfig(req)) {
            log.warn({ path: '/api/save-config' }, 'Rate limit exceeded');
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }

        // CSRF check
        if (!isSameOrigin(req)) {
            log.warn({ path: '/api/save-config' }, 'CSRF check failed');
            return res.status(403).json({ error: 'Forbidden: cross-origin request rejected.' });
        }

        let body: Record<string, unknown>;
        try {
            body = await parseBody(req);
        } catch (e) {
            log.warn({ err: e as Error, path: '/api/save-config' }, 'Failed to parse request body');
            return res.status(400).json({ error: 'Invalid request body' });
        }

        // Zod validation
        const parsed = saveConfigSchema.safeParse(body);
        if (!parsed.success) {
            log.warn({ errors: parsed.error.flatten().fieldErrors, path: '/api/save-config' }, 'Validation failed');
            return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
        }

        const protocol = req.headers?.['x-forwarded-proto'] || 'https';
        const host = req.headers?.['host'];
        const baseUrl = `${protocol}://${host}`;

        try {
            const result = saveConfig(parsed.data, baseUrl);
            log.info({ token: result.token }, 'Config saved successfully');
            return res.status(200).json({
                token: result.token,
                manifestUrl: result.manifestUrl,
                installUrl: result.installUrl,
            });
        } catch (e) {
            log.error({ err: e as Error, path: '/api/save-config' }, 'Failed to save config');
            return res.status(500).json({ error: 'Failed to save configuration' });
        }
    }

    // -----------------------------------------------
    // Manifest: /{token}/manifest.json
    // -----------------------------------------------
    if (pathWithoutQuery.endsWith('/manifest.json')) {
        const token = pathWithoutQuery.replace('/manifest.json', '').replace(/^\//, '');

        // SEC-02 FIX: Look up config by opaque token
        const config = getConfig(token);
        if (config) {
            const norm = normalizeConfig(config);
            res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
            return res
                .status(200)
                .setHeader('Content-Type', 'application/json')
                .json(
                    buildManifest(
                        norm!.country,
                        norm!.multiCountries,
                        norm!.movieType,
                        norm!.seriesType,
                    ),
                );
        }

        // Backward compatibility: try parsing as legacy encoded config
        const legacyConfig = parseConfig(token);
        if (legacyConfig) {
            log.warn({ token }, 'Legacy encoded config URL detected — consider regenerating install link');
            res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
            return res
                .status(200)
                .setHeader('Content-Type', 'application/json')
                .json(
                    buildManifest(
                        legacyConfig.country,
                        legacyConfig.multiCountries,
                        legacyConfig.movieType,
                        legacyConfig.seriesType,
                    ),
                );
        }

        return res
            .status(404)
            .json({ error: 'Configuration not found. Please regenerate your install link.' });
    }

    // -----------------------------------------------
    // Catalog: /{token}/catalog/{type}/{id}.json (rate-limited)
    // -----------------------------------------------
    const catalogMatch = pathWithoutQuery.match(
        /^\/(.*?)\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/,
    );
    if (catalogMatch) {
        // Rate limiting
        if (!await rateLimitCatalog(req)) {
            log.warn({ path: pathWithoutQuery }, 'Rate limit exceeded for catalog');
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }

        const token = catalogMatch[1];
        const config = getConfig(token);
        let norm: NormalizedConfig | null = null;

        if (config) {
            norm = normalizeConfig(config);
        } else {
            // Backward compatibility: try legacy encoded config
            norm = parseConfig(token);
            if (norm) {
                log.warn({ token }, 'Legacy encoded config URL detected for catalog request');
            }
        }

        if (!norm) {
            return res
                .status(400)
                .json({
                    error: 'Missing or invalid configuration. Please regenerate your install link.',
                });
        }

        const catalogType = catalogMatch[3].includes('movies_') ? 'movie' : 'series';
        const metas = await buildCatalog(
            catalogType,
            catalogMatch[3],
            norm.tmdbApiKey,
            norm.rpdbApiKey,
            norm.multiCountries,
        );

        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
        return res.status(200)
            .setHeader('Content-Type', 'application/json')
            .json({ metas });
    }

    // -----------------------------------------------
    // RSS Feed: /{token}/feed/{type}/{id}.xml
    // -----------------------------------------------
    const feedMatch = pathWithoutQuery.match(
        /^\/(.*?)\/feed\/([^/]+)\/([^/]+)\.xml$/,
    );
    if (feedMatch) {
        const token = feedMatch[1];
        const feedType = feedMatch[2];
        const feedId = feedMatch[3];

        const config = getConfig(token);
        let norm: NormalizedConfig | null = null;

        if (config) {
            norm = normalizeConfig(config);
        } else {
            norm = parseConfig(token);
            if (norm) {
                log.warn({ token }, 'Legacy encoded config URL detected for feed request');
            }
        }

        if (!norm) {
            return res
                .status(400)
                .json({ error: 'Missing or invalid configuration. Please regenerate your install link.' });
        }

        const protocol = req.headers?.['x-forwarded-proto'] || 'https';
        const host = req.headers?.['host'];
        const baseUrl = `${protocol}://${host}`;

        try {
            const rss = await generateRSSFeed(feedType, feedId, norm.tmdbApiKey, norm.rpdbApiKey, norm.multiCountries, baseUrl);
            res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
            return res.status(200)
                .setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
                .send(rss);
        } catch (e) {
            log.error({ err: e as Error, path: pathWithoutQuery }, 'Failed to generate RSS feed');
            return res.status(500).json({ error: 'Failed to generate RSS feed' });
        }
    }

    // -----------------------------------------------
    // 404
    // -----------------------------------------------
    log.info({ path: pathWithoutQuery }, 'Route not found');
    return res.status(404).send('Not Found');
}

// Allow both ESM default export and CommonJS module.exports
module.exports = handler;
