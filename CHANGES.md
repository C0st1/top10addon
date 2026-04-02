# Streaming-Top-10 Changelog

---

## v3.7.5 — TMDB Authentication Fix

### Summary

Bugfix release that resolves catalog loading failures and TMDB API key validation errors introduced in v3.7.4.

### Files Modified (1 file)

| File | Changes |
|------|---------|
| `lib/tmdb.js` | TMDB v3/v4 auto-detection, all API call sites updated |
| `lib/constants.js` | Version bump |

---

### Bug Fixes

### 1. TMDB v3 API Key Authentication Broken

**Problem:** The v3.7.4 security patch (SEC-05) changed all TMDB authentication to use `Authorization: Bearer` headers exclusively. However, TMDB supports two distinct authentication methods: v3 API keys (32 hexadecimal characters) must use the `?api_key=` query parameter, while only v4 Read Access Tokens (JWT/base64 format) use the Bearer header. Sending a v3 API key as a Bearer token causes TMDB to return 401 Unauthorized, which silently broke all catalog loading, metadata matching, and API key validation.

**Impact:** All users with TMDB v3 API keys (the most common format) experienced complete catalog loading failures after upgrading to v3.7.4. The addon returned empty catalogs without any visible error messages to end users.

**Fix:** Created a new `getTmdbRequestOpts()` function that auto-detects the key format at runtime:
- **v3 API keys** (exactly 32 hex characters, e.g., `abcdef1234567890abcdef1234567890`) → appends `?api_key=` query parameter
- **v4 Read Access Tokens** (any other format containing dots, e.g., JWT) → uses `Authorization: Bearer` header

Updated all 4 TMDB API call sites in `_matchTMDBInternal()` (search, find, detail) and `validateTmdbKey()` to use `getTmdbRequestOpts()` instead of hardcoded Bearer auth.

**Files:** `lib/tmdb.js`

### 2. API Key Format Validation Too Restrictive

**Problem:** The `isValidApiKeyFormat()` validation in `api/index.js` rejected valid v4 Read Access Tokens because they contain dot characters (`.`), which were not included in the allowed character set.

**Fix:** Updated the format validation regex to accept dot characters, allowing both v3 keys (`/^[a-f0-9]{32}$/i`) and v4 tokens (containing letters, digits, hyphens, underscores, and dots).

**Files:** `lib/tmdb.js`, `api/index.js`

### 3. README.md Updated

**Problem:** README was still at v3.7.1 and did not reflect any of the security fixes, new features, or deployment changes from v3.7.2 through v3.7.5.

**Fix:** Complete rewrite of README.md with all changelog entries, security architecture documentation, updated environment variables, migration guide, and current API endpoint descriptions.

**Files:** `README.md`

---

## v3.7.4 — Comprehensive Security Patch

### Summary

This security patch fixes **20 additional security issues** discovered during a comprehensive line-by-line security audit, on top of the fixes in v3.7.2/v3.7.3.

### Files Modified (10 files)

| File | Issues Fixed |
|------|-------------|
| `api/index.js` | SEC-006, SEC-009/024, SEC-015, SEC-017, SEC-018, SEC-019, SEC-028, SEC-030, SEC-031, SEC-032 |
| `lib/constants.js` | SEC-011, SEC-012, version bump |
| `lib/utils.js` | SEC-013 |
| `lib/config-store.js` | SEC-016 |
| `lib/tmdb.js` | SEC-020 |
| `lib/scraper.js` | SEC-026 |
| `lib/metrics.js` | SEC-029 |
| `lib/manifest.js` | SEC-034 |
| `lib/template.js` | SEC-012 |
| `package.json` | SEC-033, version bump |

### High Severity Fixes

| # | ID | Description |
|---|-----|-------------|
| 1 | SEC-006 | **Prototype Pollution** — Added recursive `sanitizePrototypeKeys()` to strip `__proto__`, `constructor`, `prototype` from request body |
| 2 | SEC-009/024 | **Country Validation Missing** — Added `validateCountry()` with whitelist validation + 500-char limit before storing in token |
| 3 | SEC-030 | **No HTTPS Redirect** — Added 301 redirect for HTTP requests via `x-forwarded-proto` check (defense-in-depth) |

### Medium Severity Fixes

| # | ID | Description |
|---|-----|-------------|
| 4 | SEC-011 | **Overly Permissive img-src** — Restricted CSP from `https:` wildcard to specific domains (image.tmdb.org, img.icons8.com, api.ratingposterdb.com) |
| 5 | SEC-012 | **unsafe-inline in style-src** — Replaced with per-request nonce on `<style>` tag |
| 6 | SEC-013 | **Incomplete escapeJs()** — Added escapes for `\n`, `\r`, `\0`, `\/`, `\u2028`, `\u2029` |
| 7 | SEC-015 | **Permissive Token Detection** — Replaced `token.includes('%')` with `/%[0-9A-Fa-f]{2}/` regex |
| 8 | SEC-016 | **Legacy Config Field Injection** — Added field allowlisting in `parseConfig()` (only known fields accepted) |
| 9 | SEC-017 | **X-Forwarded-Proto Trust** — Added `validateForwardedProto()` to only accept `http` or `https` |
| 10 | SEC-018 | **No Rate Limit on OPTIONS** — Applied health rate limiter to CORS preflight requests |
| 11 | SEC-019 | **CORS Methods Overexposure** — Per-endpoint `Access-Control-Allow-Methods` (least privilege) |
| 12 | SEC-020 | **RPDB Key Length** — Added 200-char max length check to prevent URL overflow |
| 13 | SEC-022 | **Conditional HSTS** — Made HSTS unconditional on all responses |
| 14 | SEC-026 | **Unsanitized HTML Content** — Added `sanitizeExternalText()` for cheerio-extracted text |

### Low Severity Fixes

| # | ID | Description |
|---|-----|-------------|
| 15 | SEC-028 | **Token Validation Inconsistency** — Extracted shared `validateTokenFormat()` |
| 16 | SEC-029 | **Metrics Path Leakage** — Extended path normalization to catalog segments |
| 17 | SEC-031 | **Error Response Caching** — Added `Cache-Control: no-store` to all error responses |
| 18 | SEC-032 | **Hash Truncation** — Increased `safeTokenHash` from 12 to 16 hex chars (64-bit) |
| 19 | SEC-033 | **Pre-Release cheerio** — Updated from `1.0.0-rc.12` to stable `^1.0.0` |
| 20 | SEC-034 | **Cache Key Collision** — Added pipe character sanitization in manifest cache key |

---

## v3.7.3 — Core Security Hardening

### Summary

Initial security hardening release addressing **11 critical and high-severity issues** from the comprehensive security audit. Includes breaking changes to encryption and deployment requirements.

### Files Modified (7 files)

| File | Issues Fixed |
|------|-------------|
| `api/index.js` | SEC-02 (CORS), SEC-03 (nonce CSP), SEC-04 (body size limit), SEC-08 (rate limiting), SEC-09 (JSON depth), SEC-10 (HSTS), SEC-11 (deprecated header), SEC-14 (error messages), SEC-15 (metrics auth) |
| `lib/config-store.js` | SEC-01 (encryption key), SEC-01b (PBKDF2 KDF) |
| `lib/tmdb.js` | SEC-05 (appendApiKey removal) |
| `lib/constants.js` | SEC-03 (CSP nonce template) |
| `lib/template.js` | SEC-03 (nonce attribute) |
| `lib/utils.js` | SEC-16 (rate limiter IP extraction) |
| `vercel.json` | SEC-10 (edge HSTS header) |

### Fixes

| # | ID | Severity | Description |
|---|-----|----------|-------------|
| 1 | SEC-01 | CRITICAL | **Predictable Encryption Key Removed** — Removed fallback key derived from hostname. `ENCRYPTION_KEY` env var is now required at startup (min 32 chars). |
| 2 | SEC-01b | CRITICAL | **PBKDF2 Key Derivation** — Replaced single SHA-256 hash with PBKDF2 (310,000 iterations, OWASP 2023 recommendation). Makes brute-force significantly more expensive. |
| 3 | SEC-02 | HIGH | **CORS Hostname Matching** — Changed from `.vercel.app` wildcard to exact hostname comparison. Prevents cross-origin attacks from other Vercel deployments. |
| 4 | SEC-03 | HIGH | **Nonce-Based CSP** — Implemented per-request cryptographic nonce for `script-src` and `style-src`. Eliminates `unsafe-inline`/`unsafe-eval`. |
| 5 | SEC-04 | HIGH | **Request Body Size Limit** — Added `Content-Length` pre-check (100KB max) before Vercel body parsing. Prevents memory exhaustion attacks. |
| 6 | SEC-05 | HIGH | **TMDB Auth Centralization** — Removed dead `appendApiKey()` function. All TMDB calls routed through unified auth handling. |
| 7 | SEC-08 | MEDIUM | **Rate Limiting Expansion** — Added rate limiting to manifest and config page endpoints (previously unprotected). |
| 8 | SEC-09 | MEDIUM | **JSON Depth Limit** — Added maximum JSON nesting depth validation (10 levels) to prevent stack overflow. |
| 9 | SEC-10 | LOW | **Edge HSTS** — Added `Strict-Transport-Security` to `vercel.json` edge headers alongside application-level HSTS. |
| 10 | SEC-11 | LOW | **Deprecated Header Removal** — Removed `X-XSS-Protection` header (deprecated in modern browsers, can be used for mXSS attacks). |
| 11 | SEC-14 | LOW | **Error Message Sanitization** — Generalized error responses to prevent internal information leakage. |
| 12 | SEC-15 | HIGH | **Metrics Authentication** — Added `METRICS_API_KEY` requirement for `/metrics` and `/status/circuit-breakers`. Supports both Bearer header and query param auth. |
| 13 | SEC-16 | LOW | **Rate Limiter IP Extraction** — Uses rightmost IP from `x-forwarded-for` (Vercel's real client IP) instead of first IP (could be spoofed). |

### Breaking Changes

- **`ENCRYPTION_KEY` is now required** — Application will fail to start without it
- **Existing tokens invalidated** — Tokens encrypted with the old key (v3.7.2 and earlier) cannot be decrypted with PBKDF2-derived keys. Users must regenerate install links.
- **Metrics endpoints require auth** — `/metrics` and `/status/circuit-breakers` return 401 without `METRICS_API_KEY`

---

## v3.7.2 — Performance & Reliability

### Summary

Comprehensive performance optimization and reliability improvements based on code review findings.

### Performance Fixes

| # | ID | Description |
|---|-----|-------------|
| 1 | PERF-01 | Reduced TMDB API calls via batch approach (`append_to_response=external_ids`) |
| 2 | PERF-02 | LRU cache with proper eviction strategy and TTL support |
| 3 | PERF-03 | Module-level HTML caching for scraped pages |
| 4 | PERF-04 | Top-level `require()` calls only (no lazy loading overhead) |
| 5 | PERF-06 | Manifest caching by input signature |
| 6 | PERF-07 | O(n) deduplication with Sets |
| 7 | PERF-10 | In-flight request deduplication to prevent duplicate concurrent API calls |

### Reliability Fixes

| # | ID | Description |
|---|-----|-------------|
| 8 | REL-01 | Multiple scraping strategies with fallbacks for different FlixPatrol layouts |
| 9 | REL-02 | Comprehensive error logging in all catch blocks |
| 10 | REL-03 | Race condition fixes in deduplication (store promise before awaiting) |

---

## v3.7.1 — Scraper Fix

### Summary

Bugfix release for FlixPatrol scraping compatibility.

### Fixes

- Updated scraper to handle FlixPatrol's new HTML structure (section IDs `#toc-netflix-movies` and `#toc-netflix-tv-shows`)
- Added multiple fallback strategies for different page layouts

---

## v3.7.0 — Observability & Monitoring

### Summary

Major feature release adding observability, monitoring, and reliability infrastructure.

### New Features

| Feature | Description |
|---------|-------------|
| **Request ID Tracing** | Unique `X-Request-Id` header on every request for distributed tracing |
| **Structured JSON Logging** | Cloud-friendly JSON log format for easier parsing and analysis |
| **Prometheus Metrics** | `/metrics` endpoint with `http_requests_total`, `http_request_duration_seconds`, cache stats, external API stats |
| **Circuit Breaker** | Protects against cascading failures from TMDB, FlixPatrol, and RPDB outages |
| **Enhanced Health Checks** | `/health` reports dependency status, circuit breaker states, and rate limit config |
| **OpenAPI Documentation** | Full API specification in `openapi.json` |

---

## Cumulative Security Summary (v3.7.3 → v3.7.5)

Across three security-focused releases, **31 security issues** have been identified and resolved:

| Severity | Count | Examples |
|----------|-------|---------|
| CRITICAL | 2 | Predictable encryption key, weak key derivation |
| HIGH | 7 | CORS bypass, prototype pollution, no HTTPS redirect, country injection, metrics auth |
| MEDIUM | 11 | CSP issues, incomplete sanitization, header trust, timer leaks |
| LOW | 11 | Error leakage, inconsistent validation, deprecated headers, pre-release deps |

### Deferred

| ID | Description | Reason |
|-----|-------------|--------|
| SEC-003 | API keys stored in client-deliverable tokens | Architectural — requires server-side credential storage redesign |

---

## Deployment Notes

### Current Requirements (v3.7.5)

| Variable | Required | Description |
|----------|----------|-------------|
| `ENCRYPTION_KEY` | **Yes** | Min 32 characters. Used for AES-256-GCM with PBKDF2 (310K iterations). |
| `METRICS_API_KEY` | No | Enables `/metrics` and `/status/circuit-breakers` endpoints when set. |

### Token Compatibility Matrix

| Token Created With | Works In |
|-------------------|----------|
| v3.7.5 | v3.7.5+ |
| v3.7.4 | v3.7.4+ |
| v3.7.3 | v3.7.3+ |
| v3.7.2 and earlier | ❌ Must regenerate |

### Upgrade Path

```bash
# Deploy latest code
vercel --prod

# First-time setup (required since v3.7.3)
vercel env add ENCRYPTION_KEY
# Paste output of: openssl rand -base64 32

# Optional: enable monitoring
vercel env add METRICS_API_KEY
# Paste a secure random string
```
