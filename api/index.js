// ============================================================
// Vercel / Node.js Server — Netflix Top 10 Stremio Addon v3.7.3
// ARCH-01 FIX: Thin routing layer; logic in lib/ modules
// SEC-02 FIX: Exact hostname comparison for CORS origin validation
// SEC-03 FIX: Rate limiting on all token-based routes
// SEC-04 FIX: Restrict CORS on mutation endpoints
// SEC-06 FIX: Rate limiting on all routes
// SEC-07 FIX: Host header validation; no reflected host in error responses
// SEC-08 FIX: Nonce-based CSP for HTML pages (no unsafe-inline)
// SEC-09 FIX: Request body size & depth validation
// SEC-09b FIX: Token hash logged instead of prefix (SEC-09)
// SEC-10 FIX: Security headers (CSP, HSTS, X-Frame-Options, etc.)
// SEC-13 FIX: Input sanitization on type overrides
// SEC-14 FIX: Error messages generalized to prevent info leakage
// SEC-15 FIX: Monitoring endpoints require METRICS_API_KEY auth
// SEC-16 FIX: Rate limiter uses rightmost untrusted IP from x-forwarded-for
// LOG-01 FIX: Circular reference protection in getJsonDepth()
// LOG-02 FIX: Invalid host returns clean 400 without reflected URL
// PERF-04 FIX: All require() calls at module top level
// RD-01  FIX: Extracted route handlers into named functions
// REC-6: Request ID for tracing
// REC-7: Structured JSON logging
// REC-8: Enhanced health check with dependencies
// REC-10: Circuit breaker integration
// REC-12: Metrics export
// ============================================================

const crypto = require('crypto');                              // PERF-04 + SEC-09b
const { buildConfigHTML } = require('../lib/template');
const { fetchFlixPatrolTitles, getAvailableCountries } = require('../lib/scraper');
const { buildManifest, buildCatalog } = require('../lib/manifest');
const { validateTmdbKey } = require('../lib/tmdb');
const { saveConfig, getConfig, parseConfig, normalizeConfig } = require('../lib/config-store');
const { RateLimiter, isValidApiKeyFormat, sanitizeTypeString, generateToken: generateRequestId } = require('../lib/utils');
const { VERSION, RATE_LIMITS, SECURITY, ALLOWED_CATALOG_TYPES, HEALTH_CHECK, FLIXPATROL_COUNTRIES } = require('../lib/constants');
const { createLogger } = require('../lib/logger');
const { circuitBreakers, CircuitState } = require('../lib/circuit-breaker');
const { metrics, trackHttpRequest, trackRateLimitExceeded, trackExternalApiCall } = require('../lib/metrics');

// PERF-04 FIX: All requires at module top level — no require() inside handlers

// SEC-15 FIX: Metrics API key for monitoring endpoint authentication
const METRICS_API_KEY = process.env.METRICS_API_KEY || '';

// SEC-06 FIX: Initialize rate limiters per route category
const rateLimiters = {
    api: new RateLimiter(RATE_LIMITS.API),
    catalog: new RateLimiter(RATE_LIMITS.CATALOG),
    health: new RateLimiter(RATE_LIMITS.HEALTH),
    metrics: new RateLimiter(RATE_LIMITS.METRICS),
    manifest: new RateLimiter(RATE_LIMITS.MANIFEST),        // SEC-03 FIX
    configPage: new RateLimiter(RATE_LIMITS.CONFIG_PAGE),   // SEC-03 FIX
};

// ============================================================
// Helper Utilities
// ============================================================

/**
 * SEC-16 FIX: Get client IP from Vercel headers.
 * Uses the RIGHTMOST IP in x-forwarded-for as the client IP,
 * because Vercel (and most CDNs) append the real client IP at the end.
 * The leftmost entries can be set by any upstream proxy and are untrusted.
 * @param {Object} req
 * @returns {string}
 */
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // Vercel appends the real client IP as the last entry
        const ips = forwarded.split(',').map(ip => ip.trim()).filter(ip => ip);
        if (ips.length > 0) {
            return ips[ips.length - 1] || 'unknown';
        }
    }
    return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * SEC-02 FIX: Extract hostname from a URL string for exact comparison.
 * Prevents substring-based bypass where "evil-example.com" matches "example.com".
 * @param {string} urlString
 * @returns {string}
 */
function extractHostname(urlString) {
    if (!urlString || typeof urlString !== 'string') return '';
    try {
        return new URL(urlString).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/**
 * SEC-02 FIX: Validate that an origin matches the current deployment.
 * Only allows the exact host from the Host header — no wildcard .vercel.app.
 * @param {string} originHost - Hostname from the Origin header
 * @param {string} requestHost - Host header value from the request
 * @returns {boolean}
 */
function isOriginAllowed(originHost, requestHost) {
    if (!originHost || !requestHost) return false;
    // Exact match: the origin host must match the request host exactly
    const normalizedRequestHost = requestHost.split(':')[0].toLowerCase();
    return originHost === normalizedRequestHost;
}

/**
 * SEC-028 FIX: Shared token validation for manifest and catalog handlers.
 * Ensures consistent validation across all token-accepting endpoints.
 * SEC-015 FIX: Proper URL-encoded validation using regex.
 * @param {string} token
 * @returns {{ valid: boolean, format: string|null }}
 */
function validateTokenFormat(token) {
    // New encrypted format: URL-safe base64 with dots
    const isNewToken = /^[A-Za-z0-9._~-]+$/.test(token) && token.length > 50;
    // Legacy format: 32-char hex or URL-encoded JSON starting with %7B ({)
    const isLegacyToken = /^[a-zA-Z0-9]{32}$/.test(token) || token.startsWith('%7B');
    // SEC-015 FIX: Proper URL-encoded validation — % must be followed by 2 hex digits
    const isUrlEncoded = /%[0-9A-Fa-f]{2}/.test(token);

    if (isNewToken) return { valid: true, format: 'new' };
    if (isLegacyToken) return { valid: true, format: 'legacy' };
    if (isUrlEncoded) return { valid: true, format: 'urlencoded' };
    return { valid: false, format: null };
}

/**
 * SEC-009/SEC-024 FIX: Validate country parameter against known country list.
 * For comma-separated multi-country values, validates each individual country.
 * Also enforces maximum length (500 chars) to prevent token bloat.
 * @param {string} countryValue
 * @returns {{ valid: boolean, error: string|null, normalized: string }}
 */
function validateCountry(countryValue) {
    if (!countryValue || typeof countryValue !== 'string') {
        return { valid: false, error: 'Country is required', normalized: '' };
    }
    const trimmed = countryValue.trim();
    if (trimmed.length > 500) {
        return { valid: false, error: 'Country value too long (max 500 chars)', normalized: '' };
    }
    if (!trimmed) {
        return { valid: false, error: 'Country is required', normalized: '' };
    }

    // Split on commas for multi-country support
    const countries = trimmed.split(',').map(c => c.trim()).filter(c => c);
    if (countries.length === 0) {
        return { valid: false, error: 'At least one country is required', normalized: '' };
    }

    // Validate each country against the whitelist (case-insensitive)
    const validCountries = [];
    for (const c of countries) {
        const match = FLIXPATROL_COUNTRIES.find(
            fc => fc.toLowerCase() === c.toLowerCase()
        );
        if (match) {
            validCountries.push(match);
        } else {
            return { valid: false, error: `Unknown country: "${c}"`, normalized: '' };
        }
    }

    return { valid: true, error: null, normalized: validCountries.join(',') };
}

/**
 * SEC-017 FIX: Validate x-forwarded-proto header value.
 * Only allows 'http' or 'https' — rejects arbitrary values.
 * @param {string|undefined} proto
 * @returns {string} 'https' or 'http'
 */
function validateForwardedProto(proto) {
    if (proto === 'http' || proto === 'https') return proto;
    return 'https'; // Default to https if header is missing or invalid
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
 * Generate a cryptographically secure nonce for CSP.
 * @returns {string} Base64-encoded random nonce
 */
function generateCspNonce() {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * SEC-08 FIX: Apply security headers to all responses.
 * Nonce-based CSP for HTML pages (replaces NONCE placeholder).
 * SEC-022 FIX: Set HSTS unconditionally (Vercel always serves HTTPS).
 * SEC-017 FIX: Validate x-forwarded-proto before trusting it.
 * SEC-031 FIX: Add Cache-Control: no-store on error responses.
 * @param {Object} res
 * @param {boolean} isHtml - Whether the response is HTML
 * @param {string} [nonce] - CSP nonce for HTML responses
 * @param {boolean} [isError=false] - Whether this is an error response
 */
function setSecurityHeaders(res, isHtml = false, nonce = '', isError = false) {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Referrer policy
    res.setHeader('Referrer-Policy', SECURITY.REFERRER_POLICY);
    // Permissions policy
    res.setHeader('Permissions-Policy', SECURITY.PERMISSIONS_POLICY);
    // SEC-022 FIX: HSTS unconditionally — Vercel always serves HTTPS.
    // Setting it unconditionally provides defense-in-depth against header stripping.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // SEC-031 FIX: Prevent caching of error responses
    if (isError) {
        res.setHeader('Cache-Control', 'no-store');
    }

    if (isHtml && nonce) {
        // SEC-08 FIX: Replace NONCE placeholder with actual nonce value
        const csp = SECURITY.CONTENT_SECURITY_POLICY.replace(/NONCE/g, nonce);
        res.setHeader('Content-Security-Policy', csp);
    }
}

/**
 * SEC-02 FIX: Set CORS headers — restrictive for mutations.
 * Uses exact hostname comparison instead of substring or wildcard.
 * SEC-019 FIX: Dynamic Access-Control-Allow-Methods per endpoint type.
 * @param {Object} res
 * @param {boolean} isMutation - Whether the endpoint modifies state
 * @param {string} [allowedMethods='GET,OPTIONS'] - Methods to advertise
 */
function setCORSHeaders(res, isMutation = false, allowedMethods = 'GET,OPTIONS') {
    // SEC-019 FIX: Only advertise methods the endpoint actually supports
    res.setHeader('Access-Control-Allow-Methods', allowedMethods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const origin = res.req?.headers?.origin;
    if (origin) {
        if (isMutation) {
            // SEC-02 FIX: Exact hostname comparison — no .vercel.app wildcard
            const originHost = extractHostname(origin);
            const hostHeader = (res.req?.headers?.host || '').toLowerCase();

            if (isOriginAllowed(originHost, hostHeader)) {
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
 * SEC-006 FIX: Recursively sanitize object keys to prevent prototype pollution.
 * Strips __proto__, constructor, and prototype from all nested objects.
 * @param {*} obj
 * @returns {*}
 */
function sanitizePrototypeKeys(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizePrototypeKeys);
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        sanitized[key] = sanitizePrototypeKeys(value);
    }
    return sanitized;
}

/**
 * SEC-09 FIX: Safely parse JSON body with size and depth limits.
 * SEC-09 NEW: Check Content-Length header first (before Vercel auto-parse).
 * SEC-006 FIX: Sanitize prototype pollution keys before processing.
 * LOG-01 FIX: Uses WeakSet to detect circular references in depth calculation.
 * @param {Object} req
 * @returns {{ body: Object|null, error: string|null }}
 */
function safeParseBody(req) {
    // SEC-09 NEW: Check Content-Length header to catch oversized bodies
    // before Vercel auto-parses them (Vercel has a 4.5MB limit, we want 100KB)
    const contentLength = parseInt(req.headers['content-length'], 10);
    if (!isNaN(contentLength) && contentLength > SECURITY.MAX_REQUEST_BODY_BYTES) {
        return { body: null, error: 'Request body too large' };
    }

    // Vercel auto-parses JSON request bodies — validate and sanitize
    if (req.body && typeof req.body === 'object') {
        if (getJsonDepth(req.body) > SECURITY.MAX_JSON_DEPTH) {
            return { body: null, error: 'JSON depth exceeds limit' };
        }
        // SEC-006 FIX: Strip prototype pollution keys from parsed body
        const sanitized = sanitizePrototypeKeys(req.body);
        return { body: sanitized, error: null };
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
 * LOG-01 FIX: Get the maximum depth of a nested object with circular reference protection.
 * Uses a WeakSet to track visited objects and returns Infinity on cycle detection.
 * @param {*} obj
 * @param {WeakSet} [seen] - Internal tracking for circular refs
 * @returns {number}
 */
function getJsonDepth(obj, seen) {
    if (typeof obj !== 'object' || obj === null) return 0;
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) return Infinity; // LOG-01 FIX: Circular reference detected
    seen.add(obj);
    let maxDepth = 0;
    for (const val of Object.values(obj)) {
        const d = getJsonDepth(val, seen);
        if (d === Infinity) return Infinity;
        if (d > maxDepth) maxDepth = d;
    }
    return maxDepth + 1;
}

/**
 * SEC-09b FIX: Compute a safe hash of a token for logging (no prefix leak).
 * @param {string} token
 * @returns {string} First 12 hex chars of SHA-256
 */
function safeTokenHash(token) {
    try {
        // SEC-032 FIX: Use 16 hex chars (64 bits) for stronger collision resistance
        return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
    } catch {
        return '(hash-error)';
    }
}

/**
 * SEC-15 FIX: Verify metrics API key from Bearer token or query param.
 * @param {Object} req
 * @returns {boolean}
 */
function isMetricsAuthenticated(req) {
    // If no METRICS_API_KEY is configured, metrics are disabled (return false)
    if (!METRICS_API_KEY) return false;

    // Check Authorization: Bearer <key> header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7) === METRICS_API_KEY;
    }

    // Check query parameter as fallback for Prometheus scraper compatibility
    const queryKey = req.query?.api_key || new URL(req.url || '/', 'http://localhost').searchParams.get('api_key');
    if (queryKey) {
        return queryKey === METRICS_API_KEY;
    }

    return false;
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
        results.tmdb = { status: 'unknown' };
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
        results.flixpatrol = { status: 'unknown' };
    }

    return results;
}

/**
 * SEC-03 FIX: Helper — check rate limit and return 429 if exceeded.
 * @param {Object} res
 * @param {string} key
 * @param {string} routeName
 * @param {string} method
 * @param {string} pathWithoutQuery
 * @param {Function} trackResponse
 * @param {Object} logger
 * @returns {boolean} true if allowed, false if rate-limited (response already sent)
 */
function checkRateLimit(res, key, routeName, method, pathWithoutQuery, trackResponse, logger) {
    const rl = rateLimiters[routeName].check(key);
    Object.entries(RateLimiter.headers(rl)).forEach(([k, v]) => res.setHeader(k, v));

    if (!rl.allowed) {
        trackRateLimitExceeded(routeName);
        trackResponse(429);
        res.status(429).json({ error: 'Rate limit exceeded' });
        return false;
    }
    return true;
}

// ============================================================
// Route Handlers — RD-01 FIX: Extracted from monolithic handler
// ============================================================

/**
 * SEC-03 FIX: Rate-limited config page handler.
 * SEC-08 FIX: CSP nonce applied for HTML responses.
 * SEC-019 FIX: Only advertise GET,OPTIONS for read-only page.
 */
function handleConfigPage(req, res, trackResponse, nonce) {
    setCORSHeaders(res, false, 'GET,OPTIONS');
    setSecurityHeaders(res, true, nonce); // SEC-08 FIX: Apply CSP with nonce to HTML
    const clientIp = getClientIp(req);
    if (!checkRateLimit(res, `${clientIp}:config`, 'configPage', req.method, '/configure', trackResponse)) return;

    const countries = getAvailableCountries();
    trackResponse(200);
    return res.status(200)
        .setHeader("Content-Type", "text/html;charset=UTF-8")
        .send(buildConfigHTML(countries, nonce));
}

/**
 * SEC-15 FIX: Metrics endpoint — requires METRICS_API_KEY authentication.
 * Without the key, returns 403 (not 404 — that would hide the endpoint's existence).
 */
function handleMetrics(req, res, trackResponse) {
    setCORSHeaders(res, false, 'GET,OPTIONS');

    // SEC-15 FIX: Require authentication for metrics
    if (!isMetricsAuthenticated(req)) {
        trackResponse(403);
        return res.status(403).json({ error: 'Forbidden' });
    }

    const clientIp = getClientIp(req);
    const pathWithoutQuery = req.url.split('?')[0];
    if (!checkRateLimit(res, `${clientIp}:metrics`, 'metrics', req.method, pathWithoutQuery, trackResponse)) return;

    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.setHeader("Cache-Control", "no-cache");
    trackResponse(200);
    return res.status(200).send(metrics.export());
}

/**
 * Health check — permissive rate limit.
 */
async function handleHealth(req, res, trackResponse, logger) {
    setCORSHeaders(res, false, 'GET,OPTIONS');
    const clientIp = getClientIp(req);
    const pathWithoutQuery = req.url.split('?')[0];
    if (!checkRateLimit(res, `${clientIp}:health`, 'health', req.method, pathWithoutQuery, trackResponse)) return;

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
        rateLimits: {
            api: RATE_LIMITS.API,
            catalog: RATE_LIMITS.CATALOG,
        },
        dependencies,
    });
}

/**
 * SEC-15 FIX: Circuit breaker status endpoint — requires authentication.
 */
function handleCircuitBreakerStatus(req, res, trackResponse) {
    setCORSHeaders(res, false, 'GET,OPTIONS');

    // SEC-15 FIX: Require authentication
    if (!isMetricsAuthenticated(req)) {
        trackResponse(403);
        return res.status(403).json({ error: 'Forbidden' });
    }

    const clientIp = getClientIp(req);
    if (!checkRateLimit(res, `${clientIp}:status`, 'health', req.method, '/status/circuit-breakers', trackResponse)) return;

    const statuses = {};
    for (const [name, cb] of Object.entries(circuitBreakers)) {
        statuses[name] = cb.getStatus();
    }
    trackResponse(200);
    return res.status(200).json(statuses);
}

/**
 * API: Validate TMDB key (rate limited).
 */
async function handleValidateTmdbKey(req, res, trackResponse, logger) {
    setCORSHeaders(res, true, 'POST,OPTIONS'); // SEC-019 FIX: Only POST for mutation
    const clientIp = getClientIp(req);
    const pathWithoutQuery = req.url.split('?')[0];
    if (!checkRateLimit(res, `${clientIp}:validate`, 'api', req.method, pathWithoutQuery, trackResponse)) return;

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

    // Basic format check before making external request
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
        return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
}

/**
 * API: Save config (rate limited, strict CORS).
 * SEC-07 FIX: Clean 400 response without reflected host when host is invalid.
 * SEC-14 FIX: Error messages generalized — no internal details leaked.
 */
async function handleSaveConfig(req, res, trackResponse, logger) {
    setCORSHeaders(res, true, 'POST,OPTIONS'); // SEC-019 FIX: Only POST for mutation
    const clientIp = getClientIp(req);
    const pathWithoutQuery = req.url.split('?')[0];
    if (!checkRateLimit(res, `${clientIp}:save`, 'api', req.method, pathWithoutQuery, trackResponse)) return;

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

    // Validate API key format before storing
    if (!isValidApiKeyFormat(tmdbApiKey)) {
        trackResponse(400);
        return res.status(400).json({ error: "Invalid TMDB API key format" });
    }

    // SEC-020 FIX: Validate RPDB API key length before storing
    const rpdbApiKey = (body?.rpdbApiKey || '').trim();
    if (rpdbApiKey && rpdbApiKey.length > 200) {
        trackResponse(400);
        return res.status(400).json({ error: "RPDB API key too long (max 200 chars)" });
    }

    // SEC-07 FIX: Validate host header before using it in URLs
    const host = req.headers['host'] || '';
    if (!isValidHost(host)) {
        logger.warn('Suspicious Host header rejected', { host });
        // LOG-02 FIX: Clean error — no reflected host in response
        trackResponse(400);
        return res.status(400).json({
            error: 'Invalid request origin',
        });
    }

    // SEC-009/SEC-024 FIX: Validate country against whitelist
    const countryValidation = validateCountry(body?.country);
    if (!countryValidation.valid) {
        trackResponse(400);
        return res.status(400).json({ error: countryValidation.error });
    }

    // SEC-017 FIX: Validate x-forwarded-proto before using for URL construction
    const protocol = validateForwardedProto(req.headers['x-forwarded-proto']);
    const baseUrl = `${protocol}://${host}`;

    // Sanitize type override strings
    const safeConfig = {
        tmdbApiKey,
        rpdbApiKey: rpdbApiKey || undefined,
        country: countryValidation.normalized,
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
        // SEC-14 FIX: Don't leak error details to client
        return res.status(500).json({ error: "Failed to save configuration" });
    }
}

/**
 * SEC-03 FIX: Rate-limited config page for token-based route.
 * SEC-08 FIX: CSP nonce applied for HTML responses.
 */
function handleTokenConfigPage(req, res, trackResponse, nonce) {
    setCORSHeaders(res, false, 'GET,OPTIONS');
    setSecurityHeaders(res, true, nonce); // SEC-08 FIX: Apply CSP with nonce to HTML
    const clientIp = getClientIp(req);
    if (!checkRateLimit(res, `${clientIp}:config`, 'configPage', req.method, '/config', trackResponse)) return;

    const countries = getAvailableCountries();
    trackResponse(200);
    return res.status(200)
        .setHeader("Content-Type", "text/html;charset=UTF-8")
        .send(buildConfigHTML(countries, nonce));
}

/**
 * SEC-03 FIX: Rate-limited manifest handler.
 * SEC-09b FIX: Token hash logged instead of prefix.
 */
async function handleManifest(req, res, token, trackResponse, logger) {
    setCORSHeaders(res, false, 'GET,OPTIONS');
    const clientIp = getClientIp(req);
    if (!checkRateLimit(res, `${clientIp}:manifest`, 'manifest', req.method, '/manifest.json', trackResponse)) return;

    // Validate token using shared validation function (SEC-028 FIX)
    const tokenCheck = validateTokenFormat(token);
    if (!tokenCheck.valid) {
        trackResponse(400);
        return res.status(400).json({ error: 'Invalid token format' });
    }

    // Try encrypted token first (new format)
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

/**
 * SEC-03 FIX: Rate-limited catalog handler.
 * SEC-09b FIX: Token hash in log instead of prefix.
 */
async function handleCatalog(req, res, token, catalogType, catalogId, trackResponse, logger) {
    setCORSHeaders(res, false, 'GET,OPTIONS');
    const clientIp = getClientIp(req);
    if (!checkRateLimit(res, `${clientIp}:catalog`, 'catalog', req.method, '/catalog', trackResponse)) return;

    // SEC-028 FIX: Shared token validation
    const tokenCheck = validateTokenFormat(token);
    if (!tokenCheck.valid) {
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
        // SEC-09b FIX: Log safe hash, not token prefix
        logger.error('Failed to decode token', {
            tokenLength: token.length,
            tokenHash: safeTokenHash(token),
        });
        trackResponse(400);
        return res.status(400).json({ error: "Missing or invalid configuration. Please regenerate your install link." });
    }

    logger.info('Building catalog', { type: catalogType, catalogId });

    try {
        const metas = await circuitBreakers.flixpatrol.executeWithFallback(
            () => buildCatalog(
                catalogType, catalogId,
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
        return res.status(503).json({ error: 'Service temporarily unavailable' });
    }
}

// ============================================================
// Main request handler — RD-01 FIX: Thin dispatcher
// ============================================================

module.exports = async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRequestId().substring(0, 16); // Shorter for logs
    const logger = createLogger(requestId);

    // Generate CSP nonce for this request (used if HTML is served)
    const cspNonce = generateCspNonce();

    // Attach request ID to response headers
    res.setHeader('X-Request-Id', requestId);

    // Security headers on all responses (non-HTML)
    setSecurityHeaders(res, false, cspNonce);

    // Handle CORS preflight
    // SEC-018 FIX: Apply lightweight rate limiting to OPTIONS requests
    if (req.method === 'OPTIONS') {
        setCORSHeaders(res);
        res.setHeader('Access-Control-Max-Age', '86400');
        // SEC-018 FIX: Rate limit OPTIONS to prevent quota exhaustion
        const optIp = getClientIp(req);
        const optRl = rateLimiters.health.check(`${optIp}:options`);
        if (!optRl.allowed) {
            return res.status(429).end();
        }
        return res.status(200).end();
    }

    // SEC-030 FIX: Enforce HTTPS redirect for non-HTTPS requests
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (forwardedProto && forwardedProto !== 'https') {
        const httpsUrl = `https://${req.headers['host'] || ''}${req.url}`;
        return res.status(301).setHeader('Location', httpsUrl).end();
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

    try {
        // -----------------------------------------------
        // Configuration page (root & /configure)
        // -----------------------------------------------
        if (pathWithoutQuery === "/" || pathWithoutQuery === "/configure") {
            return handleConfigPage(req, res, trackResponse, cspNonce);
        }

        // -----------------------------------------------
        // Metrics endpoint — Prometheus-compatible
        // SEC-15 FIX: Requires METRICS_API_KEY authentication
        // -----------------------------------------------
        if (pathWithoutQuery === "/metrics") {
            return handleMetrics(req, res, trackResponse);
        }

        // -----------------------------------------------
        // Health check — permissive rate limit
        // -----------------------------------------------
        if (pathWithoutQuery === "/health") {
            return await handleHealth(req, res, trackResponse, logger);
        }

        // -----------------------------------------------
        // Circuit breaker status endpoint
        // SEC-15 FIX: Requires METRICS_API_KEY authentication
        // -----------------------------------------------
        if (pathWithoutQuery === "/status/circuit-breakers") {
            return handleCircuitBreakerStatus(req, res, trackResponse);
        }

        // -----------------------------------------------
        // API: Validate TMDB key (rate limited)
        // -----------------------------------------------
        if (pathWithoutQuery === "/api/validate-tmdb-key" && req.method === "POST") {
            return await handleValidateTmdbKey(req, res, trackResponse, logger);
        }

        // -----------------------------------------------
        // API: Save config (rate limited, strict CORS)
        // -----------------------------------------------
        if (pathWithoutQuery === "/api/save-config" && req.method === "POST") {
            return await handleSaveConfig(req, res, trackResponse, logger);
        }

        // -----------------------------------------------
        // Configuration page (Stremio addon config route)
        // -----------------------------------------------
        const configPageMatch = pathWithoutQuery.match(/^\/([^/]+)\/config(?:ure)?$/);
        if (configPageMatch) {
            return handleTokenConfigPage(req, res, trackResponse, cspNonce);
        }

        // -----------------------------------------------
        // Manifest: /{token}/manifest.json
        // -----------------------------------------------
        if (pathWithoutQuery.endsWith("/manifest.json")) {
            const token = pathWithoutQuery.replace("/manifest.json", "").replace(/^\//, "");
            return await handleManifest(req, res, token, trackResponse, logger);
        }

        // -----------------------------------------------
        // Catalog: /{token}/catalog/{type}/{id}.json
        // -----------------------------------------------
        const catalogMatch = pathWithoutQuery.match(/^\/(.*?)\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
        if (catalogMatch) {
            const token = catalogMatch[1];
            const catalogType = catalogMatch[3].includes("movies_") ? "movie" : "series";
            return await handleCatalog(req, res, token, catalogType, catalogMatch[3], trackResponse, logger);
        }

        // -----------------------------------------------
        // 404 — Don't leak information
        // SEC-031 FIX: no-store on error
        // -----------------------------------------------
        setCORSHeaders(res, false, 'GET,OPTIONS');
        trackResponse(404);
        return res.status(404)
            .setHeader('Cache-Control', 'no-store')
            .send("Not Found");
    } catch (fatalError) {
        // Catch-all for unexpected errors in route handlers
        logger.error('Unhandled error in request handler', { error: fatalError.message });
        trackResponse(500);
        // SEC-14 FIX: Don't leak error details
        // SEC-031 FIX: no-store on error
        return res.status(500)
            .setHeader('Cache-Control', 'no-store')
            .json({ error: 'Internal server error' });
    }
};
