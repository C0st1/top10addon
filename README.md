# Netflix Top 10 — Stremio Addon v3.7.5

A fast, reliable **Stremio addon** that delivers real-time **Netflix Top 10 rankings** across 90+ countries.

Powered by live data scraping from FlixPatrol and enhanced with accurate metadata matching via TMDB, this addon brings up-to-date global and regional trends directly into your Stremio experience.

---

## What's New in v3.7.5

### Bug Fixes

- **TMDB v3 API Key Auth Fix** — Resolved catalog loading failures caused by incorrect TMDB authentication. The addon now auto-detects whether a TMDB key is a v3 API key (32 hex chars) or a v4 Read Access Token and uses the correct authentication method (query param vs. Bearer header).
- **API Key Format Validation** — Updated key format validation to accept both v3 keys and v4 tokens (which contain dots).

### Known Issue

- **Legacy Token Compatibility** — Tokens created with v3.7.2 or earlier (using the old SHA-256 key derivation) cannot be decrypted after the PBKDF2 upgrade in v3.7.3. Users must regenerate their install link via the configuration page. Tokens created with v3.7.3+ remain fully functional.

---

## What's New in v3.7.4

### Security Fixes (20 issues)

**High Severity:**
- **SEC-006**: Fixed prototype pollution via recursive `sanitizePrototypeKeys()` in request body parser
- **SEC-009/SEC-024**: Added country whitelist validation with 500-char limit before storing in token
- **SEC-030**: Added HTTPS redirect enforcement at application level (defense-in-depth)

**Medium Severity:**
- **SEC-011**: Restricted `img-src` CSP to specific domains (no broad `https:` wildcard)
- **SEC-012**: Replaced `unsafe-inline` in `style-src` CSP with per-request nonce
- **SEC-013**: Completed `escapeJs()` with full character coverage (newlines, null bytes, Unicode separators)
- **SEC-015**: Tightened URL-encoded token detection with proper hex regex validation
- **SEC-016**: Added field allowlisting to legacy config parsing
- **SEC-017**: Validated `X-Forwarded-Proto` to only accept `http` or `https`
- **SEC-018**: Added rate limiting to OPTIONS (CORS preflight) requests
- **SEC-019**: Restricted `Access-Control-Allow-Methods` per endpoint (least privilege)
- **SEC-020**: Added 200-char max length validation for RPDB API key
- **SEC-022**: Made HSTS unconditional on all responses
- **SEC-026**: Added HTML entity sanitization for cheerio-extracted external text

**Low Severity:**
- **SEC-028**: Extracted shared `validateTokenFormat()` for consistent token validation
- **SEC-029**: Extended metrics path normalization to include catalog segments
- **SEC-031**: Added `Cache-Control: no-store` to all error responses
- **SEC-032**: Increased token hash from 12 to 16 hex chars (64-bit collision resistance)
- **SEC-033**: Updated cheerio from pre-release `1.0.0-rc.12` to stable `^1.0.0`
- **SEC-034**: Added pipe character sanitization in manifest cache key

---

## What's New in v3.7.3

### Security Fixes (11 issues)

- **SEC-01**: Removed predictable encryption key fallback — `ENCRYPTION_KEY` environment variable now **required**
- **SEC-01b**: Replaced SHA-256 key derivation with PBKDF2 (310,000 iterations per OWASP 2023)
- **SEC-02**: CORS now uses exact hostname matching (no `.vercel.app` wildcard)
- **SEC-03**: Added nonce-based Content Security Policy for HTML responses
- **SEC-04**: Added `Content-Length` pre-check before Vercel body parsing (100KB limit)
- **SEC-05**: Removed `appendApiKey()` — TMDB auth centralized to proper headers/query params
- **SEC-08**: Added rate limiting on manifest and config page endpoints
- **SEC-09**: Added JSON body depth limit validation
- **SEC-10**: Added HSTS to Vercel edge headers
- **SEC-11**: Removed deprecated `X-XSS-Protection` header
- **SEC-14**: Added in-flight dedup map cleanup to prevent memory leaks
- **SEC-15**: Added `METRICS_API_KEY` authentication for monitoring endpoints

---

## What's New in v3.7.2

### Performance & Reliability

- **PERF-01**: Reduced TMDB API calls with batch approach
- **PERF-02**: LRU cache with proper eviction strategy
- **PERF-03**: Module-level HTML caching
- **PERF-04**: Top-level require() calls only
- **PERF-06**: Manifest caching by input signature
- **PERF-07**: O(n) deduplication with Sets
- **PERF-10**: In-flight request deduplication
- **REL-01**: Multiple scraping strategies with fallbacks
- **REL-02**: Comprehensive error logging
- **REL-03**: Race condition fixes in deduplication

---

## What's New in v3.7.1

### Bug Fixes

- **FlixPatrol Scraper Fix** — Updated to handle FlixPatrol's new HTML structure (section IDs `#toc-netflix-movies` and `#toc-netflix-tv-shows`)
- **Improved Scraping Reliability** — Added multiple fallback strategies for different page layouts

---

## What's New in v3.7.0

### New Features

- **Request ID Tracing** — Every request includes a unique `X-Request-Id` header for debugging
- **Structured JSON Logging** — Cloud-friendly JSON logs for easier parsing and analysis
- **Prometheus Metrics** — `/metrics` endpoint for monitoring with Prometheus-compatible format
- **Circuit Breaker** — Protects against cascading failures from external API outages
- **Enhanced Health Checks** — `/health` now reports dependency status and rate limit info
- **OpenAPI Documentation** — Full API documentation in `openapi.json`

### Initial Security Improvements (v3.6.0)

- **SEC-01**: Fixed XSS vulnerability — all DOM manipulation uses safe APIs
- **SEC-02**: API keys no longer exposed in URLs — opaque token-based storage
- **SEC-03**: TMDB authentication uses Authorization header
- **SEC-04**: Restrictive CORS for mutation endpoints
- **SEC-06**: Rate limiting on all endpoints
- **SEC-07**: Host header validation prevents URL injection
- **SEC-08**: API key format validation
- **SEC-09**: JSON body size and depth limits
- **SEC-10**: Security headers (CSP, HSTS, X-Frame-Options)
- **SEC-11**: Country slug whitelist validation
- **SEC-12**: Crypto-secure token generation
- **SEC-13**: Type override input sanitization
- **SEC-14**: Memory leak prevention in dedup maps

---

## Features

- **90+ Countries Supported** — Explore Netflix Top 10 charts from Argentina to Vietnam
- **Global Rankings** — Dedicated Global Top 10 catalog for worldwide trends
- **Live Data + Smart Caching** — Real-time scraping with LRU cache and stale-while-revalidate
- **Customizable Catalogs** — Add multiple countries with drag-and-drop reordering
- **Accurate Metadata Matching** — Year and popularity-based matching
- **RPDB Integration** — Optional rating poster overlays
- **Vercel-Ready** — Optimized for serverless deployment
- **TMDB v3 & v4 Support** — Auto-detects and correctly authenticates both key formats

---

## Project Structure

```
.
├── api/
│   └── index.js            # HTTP handler (routing, middleware, security)
├── lib/
│   ├── constants.js        # Version, countries, defaults, security config
│   ├── cache.js            # LRU cache implementation
│   ├── utils.js            # Shared helpers (fetch, escape, token generation)
│   ├── scraper.js          # FlixPatrol web scraping with sanitization
│   ├── tmdb.js             # TMDB API integration (v3/v4 auto-detection)
│   ├── manifest.js         # Stremio manifest/catalog builder
│   ├── config-store.js     # AES-256-GCM encrypted token config storage
│   ├── template.js         # XSS-safe HTML template with nonce CSP
│   ├── logger.js           # Structured JSON logging
│   ├── circuit-breaker.js  # Circuit breaker for external APIs
│   └── metrics.js          # Prometheus metrics export
├── tests/
│   ├── cache.test.js       # LRU cache tests
│   ├── utils.test.js       # Utility function tests
│   ├── manifest.test.js    # Manifest builder tests
│   ├── tmdb.test.js        # TMDB formatting tests
│   ├── config-store.test.js # Config store tests
│   ├── rate-limiter.test.js # Rate limiter tests
│   ├── scraper.test.js     # Scraper tests with mocking
│   └── integration.test.js # Integration tests
├── .env.example            # Environment variable template
├── openapi.json            # OpenAPI 3.0 documentation
├── vercel.json             # Vercel deployment config with security headers
├── package.json
└── README.md
```

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | None | Configuration page |
| `/configure` | GET | None | Configuration page |
| `/health` | GET | None | Health check with dependency status |
| `/metrics` | GET | `METRICS_API_KEY` | Prometheus-compatible metrics |
| `/status/circuit-breakers` | GET | `METRICS_API_KEY` | Circuit breaker status |
| `/api/validate-tmdb-key` | POST | None | Validate TMDB API key (v3 or v4) |
| `/api/save-config` | POST | None | Save configuration, get encrypted token |
| `/{token}/manifest.json` | GET | Token | Stremio addon manifest |
| `/{token}/catalog/{type}/{id}.json` | GET | Token | Catalog items |

### Monitoring Authentication

The `/metrics` and `/status/circuit-breakers` endpoints require a `METRICS_API_KEY` for access. If no key is configured, these endpoints are disabled. Authentication can be provided via:

- **Header**: `Authorization: Bearer <METRICS_API_KEY>`
- **Query**: `?api_key=<METRICS_API_KEY>`

---

## Rate Limits

Rate limits are enforced per-IP using a sliding window algorithm:

| Endpoint Category | Limit | Window |
|-------------------|-------|--------|
| API (validate, save-config) | 30 requests | 1 minute |
| Catalog | 15 requests | 1 minute |
| Manifest | 30 requests | 1 minute |
| Config Page | 60 requests | 1 minute |
| Health | 60 requests | 1 minute |
| Metrics | 10 requests | 1 minute |

### Rate Limit Headers

- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Seconds until window resets

### When Rate Limited (HTTP 429)

```json
{
  "error": "Rate limit exceeded"
}
```

Wait for `X-RateLimit-Reset` seconds before retrying.

---

## Setup & Installation

### 1. Get a TMDB API Key

1. Sign up at [themoviedb.org](https://www.themoviedb.org)
2. Navigate to **Settings → API**
3. Generate your **API Key (v3)** or **Read Access Token (v4)**

> The addon auto-detects your key type and uses the correct authentication method. Both formats are fully supported.

### 2. Configure & Install

1. Deploy the addon (see Deployment section below)
2. Open the configuration page: `https://your-addon-url.vercel.app/configure`
3. Enter your **TMDB API Key** or **Read Access Token**
4. Add your desired countries
5. Click **Generate Install Link**
6. Click **Install to Stremio**

> **How it works:** Your API key is encrypted with AES-256-GCM (key derived via PBKDF2 with 310,000 iterations) and embedded in the addon URL token. This means your addon URL works across serverless function instances with no server-side state. Your credentials are never exposed in plaintext. Tokens expire after 90 days.

---

## Deployment

### Deploy to Vercel (Recommended)

```bash
git clone <your-repo-url>
cd <project-folder>
npm install
npm i -g vercel
vercel
```

**Required: Set the `ENCRYPTION_KEY` environment variable in Vercel:**

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings → Environment Variables**
3. Add `ENCRYPTION_KEY` with a secure random string (at least 32 characters)
4. Generate one with: `openssl rand -base64 32`
5. Redeploy for the change to take effect

> ⚠️ **`ENCRYPTION_KEY` is mandatory.** The application will fail to start without it. This encrypts all user API keys stored in tokens using AES-256-GCM with PBKDF2 key derivation (310,000 iterations). Do NOT use a predictable or short key.

**Optional: Set `METRICS_API_KEY` for monitoring endpoints:**

1. In Vercel Dashboard → **Settings → Environment Variables**
2. Add `METRICS_API_KEY` with a secure random string
3. Without this, `/metrics` and `/status/circuit-breakers` endpoints are disabled

### Local Development

```bash
npm install

# Set required environment variable
export ENCRYPTION_KEY="$(openssl rand -base64 32)"

npm start
# Access at http://localhost:3000/configure
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

---

## Configuration Options

| Option | Description |
|---|---|
| **TMDB API Key** | Required. Fetches metadata like posters, backdrops, and IDs. Supports both v3 keys and v4 Read Access Tokens. |
| **Country Select** | Add multiple countries (each creates Movies & TV catalogs) |
| **RPDB API Key** | Optional. Enables rating-enhanced posters |
| **Tab Overrides** | Optional. Rename "Movies" / "Series" tabs in Stremio |

### Environment Variables

See `.env.example` for available configuration options. Key variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENCRYPTION_KEY` | **Yes** | — | AES-256-GCM encryption key (min 32 chars). Generates PBKDF2-derived key at 310,000 iterations. |
| `METRICS_API_KEY` | No | — | Authentication key for `/metrics` and `/status/circuit-breakers`. Disabled if not set. |
| `CACHE_TTL` | No | `3600000` | FlixPatrol cache TTL (ms) |
| `TMDB_MATCH_CACHE_TTL` | No | `21600000` | TMDB match cache TTL (ms) |
| `TMDB_CONCURRENCY` | No | `5` | Max concurrent TMDB API requests |
| `FLIXPATROL_TIMEOUT` | No | `12000` | FlixPatrol scrape timeout (ms) |
| `TMDB_TIMEOUT` | No | `8000` | TMDB API timeout (ms) |
| `CONFIG_STORE_MAX` | No | `5000` | Max config tokens in memory |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |

---

## Circuit Breaker

The addon uses circuit breakers to protect against external service failures:

| Service | Failure Threshold | Timeout |
|---------|------------------|---------|
| TMDB | 5 failures | 30 seconds |
| FlixPatrol | 3 failures | 60 seconds |
| RPDB | 5 failures | 30 seconds |

When a circuit is open, requests return HTTP 503 with a retry suggestion.

---

## Monitoring

### Health Check

```bash
curl https://your-addon.vercel.app/health
```

Response includes:
- Service status (`ok` or `degraded`)
- Dependency health (TMDB, FlixPatrol)
- Circuit breaker states
- Rate limit configuration

### Prometheus Metrics

```bash
curl https://your-addon.vercel.app/metrics \
  -H "Authorization: Bearer YOUR_METRICS_API_KEY"
# or
curl "https://your-addon.vercel.app/metrics?api_key=YOUR_METRICS_API_KEY"
```

Available metrics:
- `http_requests_total` — Request count by method, path, status
- `http_request_duration_seconds` — Request duration histogram
- `cache_hits_total` / `cache_misses_total` — Cache performance
- `external_api_requests_total` — External API call count
- `external_api_errors_total` — External API error count
- `rate_limit_exceeded_total` — Rate limit hits

---

## Caching Architecture

The addon uses a multi-layer LRU caching strategy:

1. **FlixPatrol Cache** — Scraped titles cached for 1 hour with LRU eviction
2. **TMDB Match Cache** — Title-to-metadata mappings cached for 6 hours
3. **IMDB ID Cache** — TMDB-to-IMDB mappings cached for 6 hours
4. **Catalog Cache** — Built catalogs cached for 1 hour with stale-while-revalidate
5. **HTTP Cache-Control** — Browser/CDN caching with `stale-while-revalidate`

> **Serverless Note:** In-memory caches work within a single Vercel function instance. For multi-instance deployments, consider using Vercel KV or an external Redis store.

---

## Security Architecture

This addon has undergone a comprehensive line-by-line security audit with **31 issues identified and fixed** across three patch releases (v3.7.3, v3.7.4, v3.7.5).

### Key Security Features

| Layer | Implementation |
|-------|---------------|
| **Encryption** | AES-256-GCM with PBKDF2 key derivation (310,000 iterations, OWASP 2023) |
| **Token Auth** | Encrypted tokens with 90-day expiry; no server-side credential storage |
| **CSP** | Nonce-based Content Security Policy (no `unsafe-inline` or `unsafe-eval`) |
| **CORS** | Exact hostname matching; per-endpoint method restriction |
| **HSTS** | `max-age=31536000; includeSubDomains` at edge and application level |
| **HTTPS** | Enforced at both Vercel edge and application layer (301 redirect) |
| **Rate Limiting** | Per-IP sliding window on all endpoints including OPTIONS |
| **Input Validation** | Body size limits, JSON depth limits, country whitelist, key format checks |
| **Prototype Protection** | Recursive `__proto__`/`constructor`/`prototype` stripping |
| **Header Security** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| **Metrics Auth** | `METRICS_API_KEY` required for monitoring endpoints |
| **Error Sanitization** | No internal details leaked in error responses; `Cache-Control: no-store` on errors |

### Security Headers (Vercel Edge + Application)

All responses include these security headers, applied at both the Vercel edge (`vercel.json`) and application level (`api/index.js`) for defense-in-depth:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{dynamic}'; style-src 'self' 'nonce-{dynamic}'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## Logging

Structured JSON logging is enabled by default. Each log entry includes:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Request completed",
  "service": "netflix-top10-addon",
  "version": "3.7.5",
  "requestId": "ABC123DEF456",
  "data": { "durationMs": 150 }
}
```

Set `LOG_LEVEL=debug` for verbose output.

---

## Migration Guide

### Upgrading from v3.7.2 or earlier

1. **Set `ENCRYPTION_KEY`** — This is now required. The application will not start without it.
2. **Regenerate install links** — Existing encrypted tokens from v3.7.2 and earlier are incompatible due to the PBKDF2 key derivation upgrade. Users must visit the configuration page and generate a new install link.
3. **(Optional) Set `METRICS_API_KEY`** — If you use `/metrics`, configure this key. The endpoint is now authenticated.

### Upgrading from v3.7.3 to v3.7.4

- No breaking changes — existing tokens remain valid
- Rate limiting now applies to OPTIONS requests
- Metrics and circuit breaker endpoints require `METRICS_API_KEY`

### Upgrading from v3.7.4 to v3.7.5

- No breaking changes — existing tokens remain valid
- TMDB authentication is now fixed for v3 API keys (auto-detection between v3 and v4)

---

## Disclaimer

This project is **not affiliated with Netflix**.

It uses publicly available data (via FlixPatrol) to curate ranking-based catalogs for personal use within the Stremio ecosystem.

---

## Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open a PR or start a discussion.
