// ============================================================
// Constants — Netflix Top 10 Stremio Addon v3.5.0
// ============================================================

const VERSION = "3.5.0";

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

module.exports = {
    VERSION,
    FLIXPATROL_COUNTRIES,
    DEFAULT_TITLE_OVERRIDES,
    DEFAULTS,
};
