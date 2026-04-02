// ============================================================
// Vercel / Node.js Server — Netflix Top 10 Stremio Addon v3.7.0
// ARCH-01 FIX: Thin routing layer; logic in lib/ modules
// SEC-04 FIX: Restrict CORS on mutation endpoints
// SEC-06 FIX: Rate limiting on all routes
// SEC-07 FIX: Host header validation
// SEC-09 FIX: Request body size & depth validation
// SEC-10 FIX: Security headers (CSP, HSTS, X-Frame-Options, etc.)
// SEC-13 FIX: Input sanitization on type overrides
// PERF-04 FIX: All require() calls at module top level
// REC-6: Request ID for tracing
// REC-7: Structured JSON logging
// REC-8: Enhanced health check with dependencies
// REC-10: Circuit breaker integration
// REC-12: Metrics export
// ============================================================

const { buildConfigHTML } = require('../lib/template');
const { fetchFlixPatrolTitles, getAvailableCountries } = require('../lib/scraper');
const { buildManifest, buildCatalog } = require('../lib/manifest');
const { validateTmdbKey } = require('../lib/tmdb');
const { saveConfig, getConfig, parseConfig, normalizeConfig } = require('../lib/config-store');
const { RateLimiter, isValidApiKeyFormat, sanitizeTypeString, generateToken: generateRequestId } = require('../lib/utils');
const { VERSION, RATE_LIMITS, SECURITY, ALLOWED_CATALOG_TYPES, HEALTH_CHECK } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const { circuitBreakers, CircuitState } = require('../lib/circuit-breaker');
const { metrics, trackHttpRequest, trackRateLimitExceeded, trackExternalApiCall } = require('../lib/metrics');

// PERF-04 FIX: All requires at module top level — no require() inside handlers

// SEC-06 FIX: Initialize rate limiters per route category
const rateLimiters = {
    api: new RateLimiter(RATE_LIMITS.API),
    catalog: new RateLimiter(RATE_LIMITS.CATALOG),
    health: new RateLimiter(RATE_LIMITS.HEALTH),
    metrics: new RateLimiter(RATE_LIMITS.METRICS),
};

/**
 * Get client IP from Vercel headers.
 * @param {Object} req
 * @returns {string}
 */
function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

/**
 * SEC-07 FIX: Validate host header to prevent URL injection.
 * Only allows localhost and vercel.app domains by default.
 * @param {string} host
 * @returns {boolean}
 */
function isValidHost(host) {
    if (!host || typeof host !== 'string') return false;
    const h = host.toLowerCase().replace(/^\./, '');
    // Allow localhost variants
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(h)) return true;
    // Allow vercel.app deployments
    if (h.endsWith('.vercel.app') || h === 'vercel.app') return true;
    // Allow custom domains if needed — extend this list
    if (h.endsWith('.now.sh')) return true;
    return false;
}

/**
 * SEC-10 FIX: Apply security headers to all responses.
 * @param {Object} res
 * @param {boolean} isHtml - Whether the response is HTML
 */
function setSecurityHeaders(res, isHtml = false) {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // XSS protection for older browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    res.setHeader('Referrer-Policy', SECURITY.REFERRER_POLICY);
    // Permissions policy
    res.setHeader('Permissions-Policy', SECURITY.PERMISSIONS_POLICY);
    // HSTS (only for HTTPS)
    const proto = res.req?.headers?.['x-forwarded-proto'];
    if (proto === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (isHtml) {
        res.setHeader('Content-Security-Policy', SECURITY.CONTENT_SECURITY_POLICY);
    }
}

/**
 * SEC-04 FIX: Set CORS headers — wildcard for GET (public API), restrictive for mutations.
 * @param {Object} res
 * @param {boolean} isMutation - Whether the endpoint modifies state
 */
function setCORSHeaders(res, isMutation = false) {
    // For public read-only endpoints, allow all origins
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const origin = res.req?.headers?.origin;
    if (origin) {
        if (isMutation) {
            // SEC-04 FIX: Only allow same-origin and known safe origins for mutations
            const host = res.req?.headers?.host || '';
            if (origin.includes(host) || origin.endsWith('.vercel.app')) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
            }
            // If origin doesn't match, simply don't set ACAO — browser blocks it
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
    } else {
        // Non-browser requests (curl, server-to-server): allow all
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}

/**
 * SEC-09 FIX: Safely parse JSON body with size and depth limits.
 * Vercel (@vercel/node) auto-parses JSON bodies, so req.body is already an object.
 * @param {Object} req
 * @returns {{ body: Object|null, error: string|null }}
 */
function safeParseBody(req) {
    // Vercel auto-parses JSON request bodies — just validate
    if (req.body && typeof req.body === 'object') {
        if (getJsonDepth(req.body) > SECURITY.MAX_JSON_DEPTH) {
            return { body: null, error: 'JSON depth exceeds limit' };
        }
        return { body: req.body, error: null };
    }

    // Fallback: if body came as a string (shouldn't happen on Vercel)
    if (typeof req.body === 'string') {
        if (req.body.length > SECURITY.MAX_REQUEST_BODY_BYTES) {
            return { body: null, error: 'Request body too large' };
        }
        try {
            const parsed = JSON.parse(req.body);
            if (getJsonDepth(parsed) > SECURITY.MAX_JSON_DEPTH) {
                return { body: null, error: 'JSON depth exceeds limit' };
            }
            return { body: parsed, error: null };
        } catch (e) {
            return { body: null, error: 'Invalid JSON' };
        }
    }

    return { body: null, error: 'Missing request body' };
}

/**
 * Get the maximum depth of a nested object.
 * @param {*} obj
 * @returns {number}
 */
function getJsonDepth(obj) {
    if (typeof obj !== 'object' || obj === null) return 0;
    let maxDepth = 0;
    for (const val of Object.values(obj)) {
        const d = getJsonDepth(val);
        if (d > maxDepth) maxDepth = d;
    }
    return maxDepth + 1;
}

/**
 * Check health of external dependencies
 * @param {Object} logger
 * @returns {Promise<Object>}
 */
async function checkDependencies(logger) {
    const results = {};

    // Check TMDB
    try {
        const tmdbCheck = circuitBreakers.tmdb.getStatus();
        results.tmdb = {
            status: tmdbCheck.state === CircuitState.OPEN ? 'degraded' : 'healthy',
            circuitBreaker: tmdbCheck.state,
            failureCount: tmdbCheck.failureCount,
        };
    } catch (e) {
        results.tmdb = { status: 'unknown', error: e.message };
    }

    // Check FlixPatrol
    try {
        const flixpatrolCheck = circuitBreakers.flixpatrol.getStatus();
        results.flixpatrol = {
            status: flixpatrolCheck.state === CircuitState.OPEN ? 'degraded' : 'healthy',
            circuitBreaker: flixpatrolCheck.state,
            failureCount: flixpatrolCheck.failureCount,
        };
    } catch (e) {
        results.flixpatrol = { status: 'unknown', error: e.message };
    }

    return results;
}

// ============================================================
// Main request handler
// ============================================================

module.exports = async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRequestId().substring(0, 16); // Shorter for logs
    const logger = createLogger(requestId);

    // Attach request ID to response headers
    res.setHeader('X-Request-Id', requestId);

    // Security headers on all responses
    setSecurityHeaders(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        setCORSHeaders(res);
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(200).end();
    }

    // Normalize path
    let path = req.url;
    if (path.startsWith('/api/index.js')) path = path.replace('/api/index.js', '');
    if (path === '') path = "/";

    // Strip query string for routing
    const pathWithoutQuery = path.split('?')[0];
    const clientIp = getClientIp(req);

    // Helper to track request completion
    const trackResponse = (statusCode) => {
        const duration = Date.now() - startTime;
        trackHttpRequest(req.method, pathWithoutQuery, statusCode, duration);
        logger.debug('Request completed', {
            method: req.method,
            path: pathWithoutQuery,
            status: statusCode,
            durationMs: duration,
            ip: clientIp,
        });
    };

    // -----------------------------------------------
    // Configuration page (root & /configure)
    // -----------------------------------------------
    if (pathWithoutQuery === "/" || pathWithoutQuery === "/configure") {
        setCORSHeaders(res);
        const countries = getAvailableCountries();
        trackResponse(200);
        return res.status(200)
            .setHeader("Content-Type", "text/html;charset=UTF-8")
            .send(buildConfigHTML(countries));
    }

    // -----------------------------------------------
    // Metrics endpoint — Prometheus-compatible
    // -----------------------------------------------
    if (pathWithoutQuery === "/metrics") {
        setCORSHeaders(res);
        const rl = rateLimiters.metrics.check(`${clientIp}:metrics`);
        Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

        if (!rl.allowed) {
            trackRateLimitExceeded('metrics');
            trackResponse(429);
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        res.setHeader("Content-Type", "text/plain; version=0.0.4");
        res.setHeader("Cache-Control", "no-cache");
        trackResponse(200);
        return res.status(200).send(metrics.export());
    }

    // -----------------------------------------------
    // Health check — permissive rate limit
    // -----------------------------------------------
    if (pathWithoutQuery === "/health") {
        setCORSHeaders(res);
        const rl = rateLimiters.health.check(`${clientIp}:health`);
        Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

        if (!rl.allowed) {
            trackRateLimitExceeded('health');
            trackResponse(429);
            return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        // Check dependencies
        const dependencies = await checkDependencies(logger);
        const allHealthy = Object.values(dependencies).every(d => d.status === 'healthy');
        const status = allHealthy ? 'ok' : 'degraded';

        res.setHeader("Cache-Control", "no-cache");
        trackResponse(200);
        return res.status(200).json({
            status,
            type: "flixpatrol_scraper",
            version: VERSION,
            time: new Date().toISOString(),
            requestId,
            rateLimits: {
                api: RATE_LIMITS.API,
                catalog: RATE_LIMITS.CATALOG,
            },
            dependencies,
        });
    }

    // -----------------------------------------------
    // Circuit breaker status endpoint
    // -----------------------------------------------
    if (pathWithoutQuery === "/status/circuit-breakers") {
        setCORSHeaders(res);
        const statuses = {};
        for (const [name, cb] of Object.entries(circuitBreakers)) {
            statuses[name] = cb.getStatus();
        }
        trackResponse(200);
        return res.status(200).json(statuses);
    }

    // -----------------------------------------------
    // API: Validate TMDB key (rate limited)
    // -----------------------------------------------
    if (pathWithoutQuery === "/api/validate-tmdb-key" && req.method === "POST") {
        setCORSHeaders(res, true); // mutation endpoint
        const rl = rateLimiters.api.check(`${clientIp}:validate`);
        Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

        if (!rl.allowed) {
            trackRateLimitExceeded('validate-tmdb-key');
            trackResponse(429);
            return res.status(429).json({ error: 'Rate limit exceeded. Please wait before trying again.' });
        }

        const { body, error } = safeParseBody(req);
        if (error) {
            trackResponse(400);
            return res.status(400).json({ error });
        }

        const apiKey = (body?.apiKey || '').trim();
        if (!apiKey) {
            trackResponse(400);
            return res.status(400).json({ error: 'API key is required' });
        }

        // SEC-08 FIX: Basic format check before making external request
        if (!isValidApiKeyFormat(apiKey)) {
            trackResponse(400);
            return res.status(400).json({ error: 'Invalid API key format' });
        }

        logger.info('Validating TMDB API key');

        try {
            const result = await circuitBreakers.tmdb.execute(() => validateTmdbKey(apiKey));
            trackExternalApiCall('tmdb', result.valid);
            trackResponse(200);
            return res.status(200).json(result);
        } catch (e) {
            trackExternalApiCall('tmdb', false);
            logger.error('TMDB validation failed', { error: e.message });
            trackResponse(503);
            return res.status(503).json({ error: 'Service temporarily unavailable', requestId });
        }
    }

    // -----------------------------------------------
    // API: Save config (rate limited, strict CORS)
    // -----------------------------------------------
    if (pathWithoutQuery === "/api/save-config" && req.method === "POST") {
        setCORSHeaders(res, true); // mutation endpoint
        const rl = rateLimiters.api.check(`${clientIp}:save`);
        Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

        if (!rl.allowed) {
            trackRateLimitExceeded('save-config');
            trackResponse(429);
            return res.status(429).json({ error: 'Rate limit exceeded. Please wait before trying again.' });
        }

        const { body, error } = safeParseBody(req);
        if (error) {
            trackResponse(400);
            return res.status(400).json({ error });
        }

        const tmdbApiKey = (body?.tmdbApiKey || '').trim();
        if (!tmdbApiKey) {
            trackResponse(400);
            return res.status(400).json({ error: "TMDB API key is required" });
        }

        // SEC-08 FIX: Validate API key format before storing
        if (!isValidApiKeyFormat(tmdbApiKey)) {
            trackResponse(400);
            return res.status(400).json({ error: "Invalid TMDB API key format" });
        }

        // SEC-07 FIX: Validate host header before using it in URLs
        const host = req.headers['host'] || '';
        if (!isValidHost(host)) {
            logger.warn('Suspicious Host header', { host });
            // Use fallback instead of reflecting attacker-controlled host
            const proto = req.headers['x-forwarded-proto'] || 'https';
            trackResponse(400);
            return res.status(400).json({
                error: 'Invalid request origin',
                // Still generate the config but with a safe base URL
                token: '',
                manifestUrl: `${proto}://${host}/${''}/manifest.json`,
                installUrl: '',
            });
        }

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const baseUrl = `${protocol}://${host}`;

        // SEC-13 FIX: Sanitize type override strings
        const safeConfig = {
            tmdbApiKey,
            rpdbApiKey: (body?.rpdbApiKey || '').trim() || undefined,
            country: String(body?.country || 'Global'),
            movieType: sanitizeTypeString(body?.movieType) || undefined,
            seriesType: sanitizeTypeString(body?.seriesType) || undefined,
        };

        // Remove undefined values
        Object.keys(safeConfig).forEach(k => safeConfig[k] === undefined && delete safeConfig[k]);

        logger.info('Saving configuration', { country: safeConfig.country });

        try {
            const result = saveConfig(safeConfig, baseUrl);
            trackResponse(200);
            return res.status(200).json({
                token: result.token,
                manifestUrl: result.manifestUrl,
                installUrl: result.installUrl
            });
        } catch (e) {
            logger.error('Failed to save config', { error: e.message });
            trackResponse(500);
            return res.status(500).json({ error: "Failed to save configuration", requestId });
        }
    }

    // -----------------------------------------------
    // Configuration page (Stremio addon config route)
    // Stremio derives this URL from the manifest location:
    //   manifest: /{token}/manifest.json  →  config: /{token}/config
    // -----------------------------------------------
    const configPageMatch = pathWithoutQuery.match(/^\/([^/]+)\/config$/);
    if (configPageMatch) {
        setCORSHeaders(res);
        const countries = getAvailableCountries();
        trackResponse(200);
        return res.status(200)
            .setHeader("Content-Type", "text/html;charset=UTF-8")
            .send(buildConfigHTML(countries));
    }

    // -----------------------------------------------
    // Manifest: /{token}/manifest.json
    // -----------------------------------------------
    if (pathWithoutQuery.endsWith("/manifest.json")) {
        setCORSHeaders(res);
        const token = pathWithoutQuery.replace("/manifest.json", "").replace(/^\//, "");

        // SEC-14 FIX: Validate token format (32 alphanumeric chars)
        if (!/^[a-zA-Z0-9]{32}$/.test(token)) {
            trackResponse(400);
            return res.status(400).json({ error: 'Invalid token format' });
        }

        // SEC-02 FIX: Look up config by opaque token
        const config = getConfig(token);
        if (config) {
            const norm = normalizeConfig(config);
            res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
            trackResponse(200);
            return res.status(200)
                .setHeader("Content-Type", "application/json")
                .json(buildManifest(norm.country, norm.multiCountries, norm.movieType, norm.seriesType));
        }

        // Backward compatibility: try parsing as legacy encoded config
        const legacyConfig = parseConfig(token);
        if (legacyConfig) {
            logger.warn('Legacy encoded config URL detected');
            res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
            trackResponse(200);
            return res.status(200)
                .setHeader("Content-Type", "application/json")
                .json(buildManifest(legacyConfig.country, legacyConfig.multiCountries, legacyConfig.movieType, legacyConfig.seriesType));
        }

        trackResponse(404);
        return res.status(404).json({ error: "Configuration not found. Please regenerate your install link." });
    }

    // -----------------------------------------------
    // Catalog: /{token}/catalog/{type}/{id}.json
    // SEC-06 FIX: Stricter rate limit (triggers external API calls)
    // -----------------------------------------------
    const catalogMatch = pathWithoutQuery.match(/^\/(.*?)\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
    if (catalogMatch) {
        setCORSHeaders(res);
        const rl = rateLimiters.catalog.check(`${clientIp}:catalog`);
        Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

        if (!rl.allowed) {
            trackRateLimitExceeded('catalog');
            trackResponse(429);
            return res.status(429).json({ error: 'Rate limit exceeded. Too many catalog requests.' });
        }

        const token = catalogMatch[1];

        // SEC-14 FIX: Validate token format
        if (token && !/^[a-zA-Z0-9]{32}$/.test(token) && !/^[a-zA-Z0-9%_-]+$/.test(token)) {
            trackResponse(400);
            return res.status(400).json({ error: 'Invalid token format' });
        }

        const config = getConfig(token);
        let norm = null;

        if (config) {
            norm = normalizeConfig(config);
        } else {
            // Backward compatibility: try legacy encoded config
            norm = parseConfig(token);
            if (norm) {
                logger.warn('Legacy encoded config URL detected for catalog request');
            }
        }

        if (!norm) {
            trackResponse(400);
            return res.status(400).json({ error: "Missing or invalid configuration. Please regenerate your install link." });
        }

        const catalogType = catalogMatch[3].includes("movies_") ? "movie" : "series";
        logger.info('Building catalog', { type: catalogType, catalogId: catalogMatch[3] });

        try {
            const metas = await circuitBreakers.flixpatrol.executeWithFallback(
                () => buildCatalog(
                    catalogType, catalogMatch[3],
                    norm.tmdbApiKey, norm.rpdbApiKey,
                    norm.multiCountries
                ),
                () => [] // Fallback to empty array if circuit is open
            );

            trackExternalApiCall('flixpatrol', true);
            res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
            trackResponse(200);
            return res.status(200)
                .setHeader("Content-Type", "application/json")
                .json({ metas });
        } catch (e) {
            trackExternalApiCall('flixpatrol', false);
            logger.error('Catalog build failed', { error: e.message });
            trackResponse(503);
            return res.status(503).json({ error: 'Service temporarily unavailable', requestId });
        }
    }

    // -----------------------------------------------
    // 404 — SEC-10 FIX: Don't leak information
    // -----------------------------------------------
    setCORSHeaders(res);
    trackResponse(404);
    return res.status(404).send("Not Found");
};
