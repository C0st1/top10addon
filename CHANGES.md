# Streaming-Top-10 v3.7.4 — Comprehensive Security Patch

## Summary of Changes

This security patch fixes **20 additional security issues** discovered during a comprehensive line-by-line security audit, on top of the 36 fixes in v3.7.2/v3.7.3.

### Files Modified (10 files)

| File | Issues Fixed |
|------|-------------|
| `api/index.js` | SEC-006 (prototype pollution), SEC-009/024 (country validation), SEC-015 (token detection), SEC-017 (proto validation), SEC-018 (OPTIONS rate limit), SEC-019 (CORS methods), SEC-028 (token validation dedup), SEC-030 (HTTPS redirect), SEC-031 (error caching), SEC-032 (hash truncation) |
| `lib/constants.js` | SEC-011 (img-src restriction), SEC-012 (style-src nonce), version bump |
| `lib/utils.js` | SEC-013 (escapeJs completeness) |
| `lib/config-store.js` | SEC-016 (legacy parse field allowlisting) |
| `lib/tmdb.js` | SEC-020 (RPDB key length) |
| `lib/scraper.js` | SEC-026 (external text sanitization) |
| `lib/metrics.js` | SEC-029 (path normalization in metrics) |
| `lib/manifest.js` | SEC-034 (cache key collision) |
| `lib/template.js` | SEC-012 (nonce on style tag) |
| `package.json` | SEC-033 (cheerio stable version), version bump |

---

## High Severity Fixes

### 1. SEC-006: Prototype Pollution via Unvalidated Request Body (HIGH)

**Problem:** `safeParseBody()` accepted the auto-parsed `req.body` from Vercel without sanitizing for prototype pollution vectors. If Vercel's body parser does not sanitize keys like `__proto__`, `constructor`, or `prototype`, an attacker could inject properties on `Object.prototype`, potentially bypassing validation checks, modifying defaults, or enabling remote code execution.

**Fix:** Added a recursive `sanitizePrototypeKeys()` function that strips `__proto__`, `constructor`, and `prototype` from all nested objects in the request body. Applied at the entry point inside `safeParseBody()` before any processing.

**Files:** `api/index.js`

### 2. SEC-009/SEC-024: No Country Validation Before Storing in Token (HIGH)

**Problem:** The `country` field from `handleSaveConfig()` was stored directly in the encrypted token without any validation against the allowed country list. An attacker could store arbitrary strings in the country field, which would be echoed back in manifest responses. A very long country string (up to the body size limit) would create an oversized token URL causing errors in Stremio clients.

**Fix:** Added a `validateCountry()` function that:
- Validates each comma-separated country against the `FLIXPATROL_COUNTRIES` whitelist (case-insensitive)
- Enforces a 500-character maximum length for the entire country value
- Normalizes the country name to match the official whitelist spelling
- Rejects any unknown country with a descriptive error message

**Files:** `api/index.js`

### 3. SEC-030: Missing HTTPS Redirect Enforcement (MEDIUM → HIGH)

**Problem:** The application did not enforce HTTPS by redirecting HTTP requests. If `x-forwarded-proto` indicated HTTP, the request was processed normally without redirect, potentially transmitting sensitive data (API keys, tokens) in plaintext.

**Fix:** Added an explicit HTTPS redirect at the top of the request handler. If `x-forwarded-proto` is present and not `https`, returns a 301 redirect to the HTTPS version of the URL. Vercel's platform handles this at the edge, but this provides defense-in-depth at the application level.

**Files:** `api/index.js`

---

## Medium Severity Fixes

### 4. SEC-011: Overly Permissive img-src in CSP (MEDIUM)

**Problem:** The CSP included `img-src https: data:` which allowed loading images from ANY HTTPS source on the internet. This could enable cross-site tracking or data exfiltration via crafted image URLs in user-controlled data.

**Fix:** Replaced the broad `https:` wildcard with specific domains: `img-src https://image.tmdb.org https://img.icons8.com https://api.ratingposterdb.com data:`.

**Files:** `lib/constants.js`

### 5. SEC-012: unsafe-inline Allowed in style-src CSP (MEDIUM)

**Problem:** The CSP included `style-src 'self' 'unsafe-inline'` which weakened CSP and prevented the browser from blocking inline style injection attacks.

**Fix:** Replaced `'unsafe-inline'` with `'nonce-NONCE'` in the `style-src` directive. The same nonce generated per-request is now applied to the `<style>` tag in the template via `<style nonce="${nonce}">`.

**Files:** `lib/constants.js`, `lib/template.js`

### 6. SEC-013: Incomplete escapeJs Function (MEDIUM)

**Problem:** The `escapeJs()` function was missing critical character escapes for newlines (`\n`), carriage returns (`\r`), null bytes (`\0`), forward slashes (`\/`), and Unicode line separators (`\u2028`, `\u2029`). These characters could break out of string literals in JavaScript contexts.

**Fix:** Added all missing character replacements to `escapeJs()`. The function now handles: backslash, quotes, angle brackets, newlines, CR, null bytes, forward slashes, and Unicode line separators.

**Files:** `lib/utils.js`

### 7. SEC-015: Permissive URL-Encoded Token Detection (MEDIUM)

**Problem:** The URL-encoded token check used `token.includes('%')` which was overly permissive. Any token containing a `%` character would pass the check, even if the `%` was not part of a valid URL encoding sequence.

**Fix:** Replaced with a regex check `/%[0-9A-Fa-f]{2}/` that verifies `%` is followed by exactly two hexadecimal digits. Extracted into a shared `validateTokenFormat()` function used by both manifest and catalog handlers.

**Files:** `api/index.js`

### 8. SEC-016: Legacy Config Parsing Accepts Arbitrary JSON Fields (MEDIUM)

**Problem:** `parseConfig()` (for backward compatibility with legacy tokens) accepted any arbitrary additional fields without schema validation. These extra fields were silently ignored but could interact with downstream code if new fields are added.

**Fix:** Added explicit field allowlisting. Only `tmdbApiKey`, `rpdbApiKey`, `country`, `movieType`, and `seriesType` are accepted. Tokens containing unknown fields are rejected.

**Files:** `lib/config-store.js`

### 9. SEC-017: X-Forwarded-Proto Trusted Without Validation (MEDIUM)

**Problem:** The `x-forwarded-proto` header was trusted in `handleSaveConfig()` for constructing manifest URLs and in `setSecurityHeaders()` for HSTS. If spoofed to an invalid value, it could cause protocol downgrade or header manipulation.

**Fix:** Added a `validateForwardedProto()` function that only accepts `'http'` or `'https'`. Any other value defaults to `'https'`. HSTS is now set unconditionally (SEC-022), and URL construction uses the validated protocol.

**Files:** `api/index.js`

### 10. SEC-018: No Rate Limiting on OPTIONS Requests (MEDIUM)

**Problem:** OPTIONS (CORS preflight) requests returned immediately without rate limiting. An attacker could send unlimited OPTIONS requests to exhaust serverless function invocation quotas.

**Fix:** Applied the existing health rate limiter to OPTIONS requests using the client IP key. Excessive preflight requests now receive a 429 response.

**Files:** `api/index.js`

### 11. SEC-019: Access-Control-Allow-Methods Exposes POST on Non-Mutation Endpoints (MEDIUM)

**Problem:** All endpoints advertised `Access-Control-Allow-Methods: GET,POST,OPTIONS` regardless of whether the endpoint supported POST. This violated the principle of least privilege.

**Fix:** Made `setCORSHeaders()` accept an `allowedMethods` parameter. Read-only endpoints now only advertise `GET,OPTIONS`. Mutation endpoints (`/api/validate-tmdb-key`, `/api/save-config`) advertise `POST,OPTIONS`.

**Files:** `api/index.js`

### 12. SEC-020: RPDB API Key Not Length-Validated (MEDIUM)

**Problem:** `getRpdbPosterUrl()` validated the RPDB API key format but not its length. An arbitrarily long key would create an excessively long URL exceeding typical URL length limits (~2048 chars).

**Fix:** Added a 200-character maximum length check in `getRpdbPosterUrl()` and in `handleSaveConfig()` when accepting the RPDB key from the request body.

**Files:** `lib/tmdb.js`, `api/index.js`

### 13. SEC-022: HSTS Header Conditional (MEDIUM)

**Problem:** HSTS was only set when `x-forwarded-proto === 'https'`. If the header was missing, HSTS would not be set, leaving the connection vulnerable to protocol downgrade attacks.

**Fix:** HSTS is now set unconditionally on all responses. Vercel always serves HTTPS, so this provides defense-in-depth against header stripping.

**Files:** `api/index.js`

### 14. SEC-026: Cheerio HTML Parsing of Untrusted Content (MEDIUM)

**Problem:** Text extracted from FlixPatrol HTML via cheerio was used directly in TMDB search queries, cache keys, and catalog responses without sanitization. If FlixPatrol served malicious content, specially crafted text could affect downstream processing.

**Fix:** Added a `sanitizeExternalText()` function that strips non-printable control characters, normalizes Unicode whitespace, collapses multiple whitespace into single spaces, and enforces a maximum length of 200 characters. Applied to all text extraction points in the scraper.

**Files:** `lib/scraper.js`

---

## Low Severity Fixes

### 15. SEC-028: Token Validation Inconsistent Between Handlers (LOW)

**Problem:** Token format validation was duplicated between `handleManifest()` and `handleCatalog()` with slight variations. The manifest handler did not include the `isUrlEncoded` check.

**Fix:** Extracted a shared `validateTokenFormat()` function used by both handlers. Ensures consistent validation across all token-accepting endpoints.

**Files:** `api/index.js`

### 16. SEC-029: Metrics Exposes Request Path Patterns (LOW)

**Problem:** `sanitizePathForMetrics()` only replaced token segments but not catalog type/ID segments, allowing attackers to observe which catalogs and types were being accessed.

**Fix:** Extended `sanitizePathForMetrics()` to also normalize catalog path segments (`/catalog/{type}/{id}`), reducing cardinality and information leakage.

**Files:** `lib/metrics.js`

### 17. SEC-031: No Cache-Control on Error Responses (LOW)

**Problem:** Error responses (400, 429, 500, 503, 404) did not include `Cache-Control` headers. Aggressive caching proxies might cache error responses and serve them to subsequent legitimate requests.

**Fix:** Added `Cache-Control: no-store` to all error responses: 404, 500, and via the `setSecurityHeaders(isError=true)` parameter.

**Files:** `api/index.js`

### 18. SEC-032: safeTokenHash Truncation Reduces Collision Resistance (LOW)

**Problem:** The `safeTokenHash()` function only used 12 hex characters (48 bits) of the SHA-256 hash, which could lead to collisions in systems processing millions of tokens.

**Fix:** Increased from 12 to 16 hex characters (64 bits), providing stronger collision resistance with negligible impact on log readability.

**Files:** `api/index.js`

### 19. SEC-033: Pre-Release cheerio Version (LOW)

**Problem:** The cheerio dependency was set to version `1.0.0-rc.12` (a release candidate). Pre-release versions may contain undiscovered security vulnerabilities or parsing bugs.

**Fix:** Updated to `^1.0.0` to use the stable release. The caret range allows patch updates while preventing major version breaking changes.

**Files:** `package.json`

### 20. SEC-034: Manifest Cache Key Collision (LOW)

**Problem:** The manifest cache key used pipe characters (`|`) as separators. If any parameter value (country, type) contained a pipe character, it could create cache key collisions.

**Fix:** Added pipe character sanitization to `getManifestCacheKey()`. All values used in cache keys have `|` characters stripped before concatenation.

**Files:** `lib/manifest.js`

---

## Deployment Instructions

### Prerequisites

This release maintains the same breaking changes from v3.7.3:
- `ENCRYPTION_KEY` environment variable is **required**
- Optional `METRICS_API_KEY` for monitoring endpoints

### Upgrade Steps

```bash
# Deploy the updated code
vercel --prod

# If you haven't already set ENCRYPTION_KEY (required since v3.7.3):
vercel env add ENCRYPTION_KEY
```

### Existing Tokens

Existing encrypted tokens from v3.7.3 remain valid. Tokens from v3.7.2 or earlier require regeneration.
