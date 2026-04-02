// ============================================================
// Constants — Netflix Top 10 Stremio Addon v3.7.0
// ============================================================

const VERSION = "3.7.0";

const FLIXPATROL_COUNTRIES = [
    "Global",
    "Argentina", "Australia", "Austria", "Bahamas", "Bahrain", "Bangladesh", "Belgium",
    "Bolivia", "Brazil", "Bulgaria", "Canada", "Chile", "Colombia", "Costa Rica",
    "Croatia", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador",
    "Egypt", "Estonia", "Finland", "France", "Germany", "Greece", "Guadeloupe",
    "Guatemala", "Honduras", "Hong-Kong", "Hungary", "Iceland", "India", "Indonesia",
    "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kenya", "Kuwait",
    "Latvia", "Lebanon", "Lithuania", "Luxembourg", "Malaysia", "Maldives", "Malta",
    "Martinique", "Mauritius", "Mexico", "Morocco", "Netherlands", "New Caledonia",
    "New Zealand", "Nicaragua", "Nigeria", "Norway", "Oman", "Pakistan", "Panama",
    "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Reunion",
    "Romania", "Salvador", "Saudi Arabia", "Serbia", "Singapore", "Slovakia",
    "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden",
    "Switzerland", "Taiwan", "Thailand", "Trinidad and Tobago", "Turkey", "Ukraine",
    "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Venezuela", "Vietnam"
];

// SEC-11 FIX: Pre-compute allowed slugs for country whitelist validation
const ALLOWED_COUNTRY_SLUGS = new Set(
    FLIXPATROL_COUNTRIES.map(c => {
        const lower = c.toLowerCase();
        if (lower === "global" || lower === "worldwide") return "world";
        return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    })
);

// Externalized title overrides — can be loaded from config or env
// Format: "normalized title lowercase" -> "imdb_id"
const DEFAULT_TITLE_OVERRIDES = {
    "the race": "tt35052447"
};

// Default configuration values (can be overridden via environment variables)
const DEFAULTS = {
    CACHE_TTL: 1 * 60 * 60 * 1000,           // 1 hour
    TMDB_MATCH_CACHE_TTL: 6 * 60 * 60 * 1000, // 6 hours
    TMDB_CONCURRENCY: 5,
    FLIXPATROL_TIMEOUT: 12000,
    TMDB_TIMEOUT: 8000,
    CONFIG_STORE_MAX: 5000,
    CACHE_MAX_FLIXPATROL: 1000,
    CACHE_MAX_TMDB: 2000,
    CACHE_MAX_IMDB: 5000,
    LRU_MAX_SIZE: 2000,
};

// ============================================================
// SEC-06 FIX: Rate limiting configuration
// REC-9: Documented rate limit behavior
// ============================================================
// Rate limits are enforced per-IP address using a sliding window algorithm.
// Headers returned:
//   - X-RateLimit-Remaining: Number of requests remaining in current window
//   - X-RateLimit-Reset: Seconds until the rate limit window resets
// 
// When rate limited (HTTP 429):
//   - Response body: { "error": "Rate limit exceeded" }
//   - Client should wait until X-RateLimit-Reset seconds before retrying
//
// Note: Rate limits are per-instance in serverless deployments.
// For distributed rate limiting, consider using Redis/Upstash.
// ============================================================
const RATE_LIMITS = {
    // General API endpoints (validate, save-config)
    // 30 requests per minute per IP
    API: { maxRequests: 30, windowMs: 60000 },
    // Heavy endpoints that trigger external API calls (catalog)
    // 15 requests per minute per IP (lower due to external API costs)
    CATALOG: { maxRequests: 15, windowMs: 60000 },
    // Health check — more permissive for monitoring
    // 60 requests per minute per IP
    HEALTH: { maxRequests: 60, windowMs: 60000 },
    // Metrics endpoint — for Prometheus scraping
    // 10 requests per minute per IP
    METRICS: { maxRequests: 10, windowMs: 60000 },
};

// SEC-10 FIX: Security header configuration
const SECURITY = {
    CONTENT_SECURITY_POLICY: "default-src 'self'; "
        + "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        + "font-src https://fonts.gstatic.com; "
        + "img-src https: data:; "
        + "connect-src 'self' https://api.themoviedb.org https://flixpatrol.com https://api.ratingposterdb.com;",
    REFERRER_POLICY: "strict-origin-when-cross-origin",
    PERMISSIONS_POLICY: "camera=(), microphone=(), geolocation=()",
    MAX_REQUEST_BODY_BYTES: 102400, // 100KB
    MAX_JSON_DEPTH: 10,
};

// Allowed values for type overrides
const ALLOWED_CATALOG_TYPES = ["movie", "series", "tv", "show", "films", "anime"];

// Circuit breaker configuration
const CIRCUIT_BREAKER = {
    TMDB: {
        failureThreshold: 5,
        timeout: 30000,
        monitoringWindow: 60000,
    },
    FLIXPATROL: {
        failureThreshold: 3,
        timeout: 60000,
        monitoringWindow: 120000,
    },
    RPDB: {
        failureThreshold: 5,
        timeout: 30000,
        monitoringWindow: 60000,
    },
};

// Health check configuration
const HEALTH_CHECK = {
    // Timeout for dependency health checks
    TIMEOUT_MS: 5000,
    // Services to check
    DEPENDENCIES: ['tmdb', 'flixpatrol'],
};

module.exports = {
    VERSION,
    FLIXPATROL_COUNTRIES,
    ALLOWED_COUNTRY_SLUGS,
    DEFAULT_TITLE_OVERRIDES,
    DEFAULTS,
    RATE_LIMITS,
    SECURITY,
    ALLOWED_CATALOG_TYPES,
    CIRCUIT_BREAKER,
    HEALTH_CHECK,
};
