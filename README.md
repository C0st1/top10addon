# Netflix Top 10 — Stremio Addon v4.0.0

A fast, reliable **Stremio addon** that delivers real-time **streaming platform Top 10 rankings** across 90+ countries. Now with multi-platform support, Telegram bot notifications, RSS feeds, and enterprise-grade security.

Powered by live data scraping from FlixPatrol and enhanced with accurate metadata matching via TMDB, this addon brings up-to-date global and regional trends directly into your Stremio experience.

---

## What's New in v4.0.0

This major release transforms the addon from a Netflix-only prototype into a production-grade streaming intelligence platform. It implements the Phase 1 roadmap items from the implementation plan.

### TypeScript Migration
- **Full TypeScript conversion** — Entire codebase migrated to TypeScript with strict mode, comprehensive interfaces, and generic types
- **ESLint + Prettier** — Code quality enforced with `@typescript-eslint` recommended rules and consistent formatting
- **45 test cases** — All existing tests converted to TypeScript with zero failures

### Security Hardening
- **Zod schema validation** — All API request bodies validated with Zod schemas (400 errors with field-level details)
- **Rate limiting** — Three-tier rate limiting: 10 req/min (save-config), 30 req/min (validate-key), 60 req/min (catalog)
- **Security headers** — X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection on all responses
- **Content Security Policy** — CSP headers on the configuration page to prevent injection attacks
- **CSRF protection** — Origin validation on all POST endpoints (403 on cross-origin requests)

### Pluggable Scraper Architecture
- **Provider interface** — `ScraperProvider` abstraction allows adding new data sources without modifying core code
- **Multi-platform support** — 6 streaming platforms: Netflix, Prime Video, Disney+, HBO Max, Apple TV+, Hulu
- **Provider registry** — Central registry pattern for managing and discovering scraper providers
- **Backward compatible** — Existing `fetchFlixPatrolTitles()` API unchanged

### Notification Systems
- **Telegram bot** — Full bot with `/start`, `/help`, `/top10`, `/subscribe`, `/unsubscribe`, `/countries` commands
- **Webhook notifications** — Generic webhook sender supporting JSON, Slack (Block Kit), and Microsoft Teams (Adaptive Cards)
- **RSS/Atom feed** — Standard RSS 2.0 feed endpoint for each catalog (subscribable via any RSS reader)

### Observability
- **Structured logging** — Pino-based logger with JSON output in production, pretty-printed in development
- **Enhanced health endpoint** — Memory usage (RSS, heap), process uptime, and cache statistics
- **Module-scoped loggers** — Every module has a child logger with `module` field for easy filtering

---

## Features

- **90+ Countries Supported** — Explore Top 10 charts from Argentina to Vietnam.
- **6 Streaming Platforms** — Netflix, Prime Video, Disney+, HBO Max, Apple TV+, Hulu.
- **Live Data + Smart Caching** — Real-time scraping from FlixPatrol with LRU caching and stale-while-revalidate.
- **Customizable Catalogs** — Add multiple countries and reorder them using a drag-and-drop interface.
- **Accurate Metadata Matching** — Advanced title matching using year and popularity logic ensures correct Stremio results.
- **RPDB Integration (Optional)** — Enhance posters with rating overlays via Rating Poster DB.
- **Telegram Bot** — Get daily Top 10 updates directly in your Telegram chat.
- **RSS Feeds** — Subscribe to Top 10 rankings in any RSS reader.
- **Vercel-Ready Deployment** — Optimized for serverless deployment with zero hassle.

---

## Project Structure

```
.
├── api/
│   └── index.ts               # HTTP handler (routing + security middleware)
├── lib/
│   ├── constants.ts           # Version, countries, defaults, interfaces
│   ├── cache.ts               # Generic LRU cache (CacheEntry<T>, LRUCache<T>)
│   ├── utils.ts               # Shared helpers (fetch, escape, pMap, etc.)
│   ├── scraper.ts             # Backward-compat wrapper → NetflixProvider
│   ├── tmdb.ts                # TMDB API integration (typed)
│   ├── manifest.ts            # Stremio manifest/catalog builder (multi-platform)
│   ├── config-store.ts        # Opaque token config storage
│   ├── template.js            # XSS-safe HTML template
│   ├── template.d.ts          # TypeScript declarations for template.js
│   ├── logger.ts              # Pino structured logger
│   ├── security.ts            # Rate limiting, headers, CSP, CSRF
│   ├── validation.ts          # Zod schemas for request validation
│   ├── feed.ts                # RSS 2.0 feed generator
│   ├── health.ts              # Enhanced health report
│   ├── providers/
│   │   ├── types.ts           # ScraperProvider interface
│   │   ├── flixpatrol-provider.ts  # FlixPatrol scraper (6 platforms)
│   │   ├── netflix-provider.ts     # Netflix-specific provider
│   │   ├── provider-registry.ts    # Provider discovery/management
│   │   └── index.ts           # Barrel exports
│   └── notifications/
│       ├── telegram.ts        # Telegram bot module
│       ├── webhook.ts         # Generic webhook (JSON/Slack/Teams)
│       └── index.ts           # Barrel exports
├── tests/
│   ├── cache.test.ts          # LRU cache tests (8 tests)
│   ├── utils.test.ts          # Utility function tests (14 tests)
│   ├── manifest.test.ts       # Manifest builder tests (6 tests)
│   ├── tmdb.test.ts           # TMDB formatting tests (7 tests)
│   └── config-store.test.ts   # Config store tests (10 tests)
├── .env.example               # Environment variable template
├── .eslintrc.json             # ESLint config
├── .prettierrc                # Prettier config
├── tsconfig.json              # TypeScript config
├── vitest.config.ts           # Vitest test config
├── vercel.json                # Vercel deployment config
├── package.json
├── package-lock.json
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

> **Note:** Your API key is stored securely on the server. The manifest URL contains only an opaque token — your credentials are never exposed in URLs, logs, or browser history.

### 3. Telegram Bot (Optional)

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Set the `TELEGRAM_BOT_TOKEN` environment variable
3. Set `TELEGRAM_WEBHOOK_URL` to your addon's `/api/telegram/webhook` endpoint
4. Send `/start` to your bot to begin

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
npm run dev
# Access at http://localhost:3000/configure
```

### Running Tests

```bash
npm test              # Run all tests (45 tests)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

### Linting & Formatting

```bash
npm run lint          # Check for lint errors
npm run lint:fix      # Auto-fix lint errors
npm run format        # Format all files
npm run format:check  # Check formatting
```

### Type Checking

```bash
npm run build         # Compile TypeScript (tsc)
npx tsc --noEmit      # Type check without emitting
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

| Variable | Default | Description |
|---|---|---|
| `CACHE_TTL` | `3600000` | FlixPatrol cache TTL (ms) |
| `TMDB_MATCH_CACHE_TTL` | `21600000` | TMDB match cache TTL (ms) |
| `TMDB_CONCURRENCY` | `5` | Max concurrent TMDB API requests |
| `FLIXPATROL_TIMEOUT` | `12000` | FlixPatrol scrape timeout (ms) |
| `TMDB_TIMEOUT` | `8000` | TMDB API timeout (ms) |
| `CONFIG_STORE_MAX` | `5000` | Max config tokens in memory |
| `LOG_LEVEL` | `info` | Pino log level (debug/info/warn/error) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from @BotFather |
| `TELEGRAM_WEBHOOK_URL` | — | Webhook URL for Telegram bot registration |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` `/configure` | Configuration page |
| `GET` | `/health` | Health check with memory/uptime stats |
| `POST` | `/api/validate-tmdb-key` | Validate a TMDB API key |
| `POST` | `/api/save-config` | Save configuration and get install link |
| `POST` | `/api/telegram/webhook` | Telegram bot webhook handler |
| `GET` | `/{token}/manifest.json` | Stremio addon manifest |
| `GET` | `/{token}/catalog/{type}/{id}.json` | Stremio catalog (top 10 list) |
| `GET` | `/{token}/feed/{type}/{id}.xml` | RSS 2.0 feed of top 10 list |

---

## Caching Architecture

The addon uses a multi-layer LRU caching strategy:

1. **FlixPatrol Cache** — Scraped titles cached for 1 hour with LRU eviction
2. **TMDB Match Cache** — Title-to-metadata mappings cached for 6 hours
3. **IMDB ID Cache** — TMDB-to-IMDB mappings cached for 6 hours
4. **Catalog Cache** — Built catalogs cached for 1 hour with stale-while-revalidate
5. **HTTP Cache-Control** — Browser/CDN caching with `stale-while-revalidate`
6. **Rate Limiting** — In-memory rate limiter per IP address

> **Serverless Note:** In-memory caches work within a single Vercel function instance. For multi-instance deployments, consider using Vercel KV or an external Redis store for persistent caching.

---

## Disclaimer

This project is **not affiliated with Netflix**, Amazon, Disney, Warner Bros., Apple, or Hulu.

It uses publicly available data (via FlixPatrol) to curate ranking-based catalogs for personal use within the Stremio ecosystem.

---

## Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open a PR or start a discussion.
