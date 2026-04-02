# Netflix Top 10 — Stremio Addon v3.5.0

A fast, reliable **Stremio addon** that delivers real-time **Netflix Top 10 rankings** across 90+ countries.

Powered by live data scraping from FlixPatrol and enhanced with accurate metadata matching via TMDB, this addon brings up-to-date global and regional trends directly into your Stremio experience.

---

## What's New in v3.5.0

This release includes a comprehensive refactoring addressing 17 code review findings:

### Security Improvements
- **SEC-01**: Fixed XSS vulnerability — all DOM manipulation now uses safe `createElement`/`textContent` APIs instead of `innerHTML` with user-controlled data
- **SEC-02**: API keys are no longer exposed in manifest URLs — configurations are stored server-side with opaque tokens
- **SEC-03**: TMDB API authentication uses `Authorization` header (Bearer tokens) instead of URL query parameters

### Architecture Improvements
- **ARCH-01**: Refactored monolithic 870-line file into 8 focused modules (`lib/`)
- **ARCH-02**: Added comprehensive test suite with 40+ test cases using Vitest
- **ARCH-03**: Added environment variable support via `.env.example`

### Reliability Improvements
- **REL-01**: Improved scraping robustness with better fallback logging and validation
- **REL-02**: All `catch {}` blocks now include proper error logging
- **REL-03**: Fixed race condition in TMDB request deduplication (promise stored before await)
- **REL-04**: Synchronized version numbers across all files

### Performance Improvements
- **PERF-01**: Reduced redundant TMDB API calls by combining search + detail fetches
- **PERF-02**: Replaced FIFO cache with proper LRU cache implementation
- **PERF-03**: Documented serverless caching limitations in README

### Code Quality
- **CQ-01**: Removed redundant duplicate condition check
- **CQ-02**: Pinned Cheerio to exact RC version for reproducibility
- **CQ-03**: Externalized title overrides to configurable constants
- **CQ-04**: Added `package-lock.json` for reproducible builds

---

## Features

- **90+ Countries Supported** — Explore Netflix Top 10 charts from Argentina to Vietnam.
- **Global Rankings** — Access a dedicated Global Top 10 catalog for worldwide trends.
- **Live Data + Smart Caching** — Real-time scraping from FlixPatrol with LRU caching and stale-while-revalidate.
- **Customizable Catalogs** — Add multiple countries and reorder them using a drag-and-drop interface.
- **Accurate Metadata Matching** — Advanced title matching using year and popularity logic ensures correct Stremio results.
- **RPDB Integration (Optional)** — Enhance posters with rating overlays via Rating Poster DB.
- **Vercel-Ready Deployment** — Optimized for serverless deployment with zero hassle.

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
│   └── template.js         # XSS-safe HTML template
├── tests/
│   ├── cache.test.js       # LRU cache tests
│   ├── utils.test.js       # Utility function tests
│   ├── manifest.test.js    # Manifest builder tests
│   ├── tmdb.test.js        # TMDB formatting tests
│   └── config-store.test.js # Config store tests
├── .env.example            # Environment variable template
├── package.json
├── vercel.json
└── README.md
```

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

> **Note:** Your API key is now stored securely on the server. The manifest URL contains only an opaque token — your credentials are never exposed in URLs, logs, or browser history.

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

---

## Caching Architecture

The addon uses a multi-layer LRU caching strategy:

1. **FlixPatrol Cache** — Scraped titles cached for 1 hour with LRU eviction
2. **TMDB Match Cache** — Title-to-metadata mappings cached for 6 hours
3. **IMDB ID Cache** — TMDB-to-IMDB mappings cached for 6 hours
4. **Catalog Cache** — Built catalogs cached for 1 hour with stale-while-revalidate
5. **HTTP Cache-Control** — Browser/CDN caching with `stale-while-revalidate`

> **Serverless Note:** In-memory caches work within a single Vercel function instance. For multi-instance deployments, consider using Vercel KV or an external Redis store for persistent caching.

---

## Disclaimer

This project is **not affiliated with Netflix**.

It uses publicly available data (via FlixPatrol) to curate ranking-based catalogs for personal use within the Stremio ecosystem.

---

## Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open a PR or start a discussion.
