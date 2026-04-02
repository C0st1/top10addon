# Netflix Top 10 — Stremio Addon v3.7.1

A fast, reliable **Stremio addon** that delivers real-time **Netflix Top 10 rankings** across 90+ countries.

Powered by live data scraping from FlixPatrol and enhanced with accurate metadata matching via TMDB, this addon brings up-to-date global and regional trends directly into your Stremio experience.

---

## What's New in v3.7.1

### Bug Fixes

- **FlixPatrol Scraper Fix** — Updated to handle FlixPatrol's new HTML structure (section IDs `#toc-netflix-movies` and `#toc-netflix-tv-shows`)
- **Improved Scraping Reliability** — Added multiple fallback strategies for different page layouts

## What's New in v3.7.0

This release includes comprehensive improvements based on code review findings:

### New Features

- **Request ID Tracing** — Every request includes a unique `X-Request-Id` header for debugging
- **Structured JSON Logging** — Cloud-friendly JSON logs for easier parsing and analysis
- **Prometheus Metrics** — `/metrics` endpoint for monitoring with Prometheus-compatible format
- **Circuit Breaker** — Protects against cascading failures from external API outages
- **Enhanced Health Checks** — `/health` now reports dependency status and rate limit info
- **OpenAPI Documentation** — Full API documentation in `openapi.json`

### Security Improvements (v3.6.0)

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

### Performance Improvements

- **PERF-01**: Reduced TMDB API calls with batch approach
- **PERF-02**: LRU cache with proper eviction strategy
- **PERF-03**: Module-level HTML caching
- **PERF-04**: Top-level require() calls only
- **PERF-06**: Manifest caching by input signature
- **PERF-07**: O(n) deduplication with Sets
- **PERF-10**: In-flight request deduplication

### Reliability Improvements

- **REL-01**: Multiple scraping strategies with fallbacks
- **REL-02**: Comprehensive error logging
- **REL-03**: Race condition fixes in deduplication

---

## Features

- **90+ Countries Supported** — Explore Netflix Top 10 charts from Argentina to Vietnam
- **Global Rankings** — Dedicated Global Top 10 catalog for worldwide trends
- **Live Data + Smart Caching** — Real-time scraping with LRU cache and stale-while-revalidate
- **Customizable Catalogs** — Add multiple countries with drag-and-drop reordering
- **Accurate Metadata Matching** — Year and popularity-based matching
- **RPDB Integration** — Optional rating poster overlays
- **Vercel-Ready** — Optimized for serverless deployment

---

## Project Structure

```
.
├── api/
│   └── index.js            # HTTP handler (routing only)
├── lib/
│   ├── constants.js        # Version, countries, defaults
│   ├── cache.js            # LRU cache implementation
│   ├── utils.js            # Shared helpers (fetch, escape, etc.)
│   ├── scraper.js          # FlixPatrol web scraping
│   ├── tmdb.js             # TMDB API integration
│   ├── manifest.js         # Stremio manifest/catalog builder
│   ├── config-store.js     # Opaque token config storage
│   ├── template.js         # XSS-safe HTML template
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
├── package.json
├── vercel.json
└── README.md
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Configuration page |
| `/configure` | GET | Configuration page |
| `/health` | GET | Health check with dependency status |
| `/metrics` | GET | Prometheus-compatible metrics |
| `/status/circuit-breakers` | GET | Circuit breaker status |
| `/api/validate-tmdb-key` | POST | Validate TMDB API key |
| `/api/save-config` | POST | Save configuration, get token |
| `/{token}/manifest.json` | GET | Stremio addon manifest |
| `/{token}/catalog/{type}/{id}.json` | GET | Catalog items |

---

## Rate Limits

Rate limits are enforced per-IP using a sliding window algorithm:

| Endpoint Category | Limit | Window |
|-------------------|-------|--------|
| API (validate, save-config) | 30 requests | 1 minute |
| Catalog | 15 requests | 1 minute |
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
3. Generate your API key (or read access token)

### 2. Configure & Install

1. Deploy the addon (see Deployment section below)
2. Open the configuration page: `https://your-addon-url.vercel.app/configure`
3. Enter your **TMDB API Key**
4. Add your desired countries
5. Click **Generate Install Link**
6. Click **Install to Stremio**

> **Note:** Your API key is encrypted and embedded in the manifest URL token. This means your addon URL works across serverless function instances (no server-side state needed). Your credentials are encrypted with AES-256-GCM and never exposed in plaintext.

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

**Important:** After deploying, set the `ENCRYPTION_KEY` environment variable in Vercel:

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings → Environment Variables**
3. Add `ENCRYPTION_KEY` with a secure random string (at least 32 characters)
4. Generate one with: `openssl rand -base64 32`
5. Redeploy for the change to take effect

> ⚠️ If you don't set `ENCRYPTION_KEY`, a default key will be used. This is fine for testing but **not secure for production**.

### Local Development

```bash
npm install
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
| **TMDB API Key** | Required. Fetches metadata like posters, backdrops, and IDs |
| **Country Select** | Add multiple countries (each creates Movies & TV catalogs) |
| **RPDB API Key** | Optional. Enables rating-enhanced posters |
| **Tab Overrides** | Optional. Rename "Movies" / "Series" tabs in Stremio |

### Environment Variables

See `.env.example` for available configuration options. Key variables:

| Variable | Default | Description |
|---|---|---|
| `CACHE_TTL` | `3600000` | FlixPatrol cache TTL (ms) |
| `TMDB_MATCH_CACHE_TTL` | `21600000` | TMDB match cache TTL (ms) |
| `TMDB_CONCURRENCY` | `5` | Max concurrent TMDB API requests |
| `FLIXPATROL_TIMEOUT` | `12000` | FlixPatrol scrape timeout (ms) |
| `TMDB_TIMEOUT` | `8000` | TMDB API timeout (ms) |
| `CONFIG_STORE_MAX` | `5000` | Max config tokens in memory |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

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
curl https://your-addon.vercel.app/metrics
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

## Logging

Structured JSON logging is enabled by default. Each log entry includes:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Request completed",
  "service": "netflix-top10-addon",
  "version": "3.7.0",
  "requestId": "ABC123DEF456",
  "data": { "durationMs": 150 }
}
```

Set `LOG_LEVEL=debug` for verbose output.

---

## Disclaimer

This project is **not affiliated with Netflix**.

It uses publicly available data (via FlixPatrol) to curate ranking-based catalogs for personal use within the Stremio ecosystem.

---

## Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open a PR or start a discussion.
