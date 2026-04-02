// ============================================================
// FlixPatrol Scraper
// Fixes REL-01: Improved robustness with validation + logging
// Fixes PERF-04: Moved require() to module top level
// Fixes PERF-07: O(n^2) dedup replaced with Set-based O(n)
// Fixes SEC-11: Country slug validated against whitelist
// LOG-03 FIX: getAvailableCountries() uses module-level import
// v3.7.1: Updated for new FlixPatrol HTML structure (section IDs)
// v3.7.2: Fixed country-specific pages (h3 headers in .card containers)
// ============================================================

const { LRUCache } = require('./cache');
const { fetchWithTimeout, getFlixPatrolSlug } = require('./utils');
const cheerio = require('cheerio');
const { DEFAULTS, ALLOWED_COUNTRY_SLUGS, FLIXPATROL_COUNTRIES } = require('./constants');

// PERF-04 FIX: require() at module level, not inside functions

// LRU cache for FlixPatrol scraping results
const flixpatrolCache = new LRUCache({
    maxSize: DEFAULTS.CACHE_MAX_FLIXPATROL,
    ttl: DEFAULTS.CACHE_TTL,
});

/**
 * Extract titles from a section of the page
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {Cheerio} section - The section element
 * @param {Set} seenTitles - Set of already seen titles for dedup
 * @param {number} maxTitles - Maximum titles to extract
 * @returns {Array<{title: string, year: string|null}>}
 */

/**
 * SEC-026 FIX: Sanitize text extracted from external HTML before downstream use.
 * Strips non-printable characters, limits length, normalizes whitespace.
 * @param {string} text
 * @param {number} [maxLength=200]
 * @returns {string}
 */
function sanitizeExternalText(text, maxLength = 200) {
    if (typeof text !== 'string') return '';
    // Strip control characters except tab, newline, carriage return
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Normalize Unicode whitespace
    sanitized = sanitized.replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]/g, ' ');
    // Collapse multiple whitespace into single space
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    // Enforce maximum length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }
    return sanitized;
}

function extractTitlesFromSection($, section, seenTitles, maxTitles = 10) {
    const titles = [];

    section.find('a[href*="/title/"]').each((i, a) => {
        if (titles.length >= maxTitles) return false;

        const $a = $(a);
        // SEC-026 FIX: Sanitize text extracted from external HTML
        const title = sanitizeExternalText($a.text().trim());
        const href = $a.attr('href') || '';
        const yearMatch = href.match(/-(\d{4})\/?$/);
        const year = yearMatch ? yearMatch[1] : null;

        if (title && !seenTitles.has(title)) {
            seenTitles.add(title);
            titles.push({ title, year });
        }
    });

    return titles;
}

/**
 * Scrape FlixPatrol for Top 10 titles.
 * SEC-11 FIX: Validates country slug against known whitelist.
 * @param {string} categoryType - "Films" or "TV"
 * @param {string} country - Country name (default "Global")
 * @returns {Promise<Array<{title: string, year: string|null}>>}
 */
async function fetchFlixPatrolTitles(categoryType, country = "Global") {
    const slug = getFlixPatrolSlug(country);

    // SEC-11 FIX: Validate slug against whitelist to prevent URL injection
    if (slug !== 'world' && !ALLOWED_COUNTRY_SLUGS.has(slug)) {
        console.warn(`[Scraper] Unknown country slug: "${slug}" — rejecting request`);
        return [];
    }

    const cacheKey = `flixpatrol_${slug}_${categoryType}`;
    const cached = flixpatrolCache.get(cacheKey);
    if (cached.data && !cached.stale) return cached.data;

    try {
        const url = `https://flixpatrol.com/top10/netflix/${slug}/`;
        const opts = {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        };
        const res = await fetchWithTimeout(url, opts, DEFAULTS.FLIXPATROL_TIMEOUT);
        if (!res.ok) {
            console.warn(`[Scraper] FlixPatrol returned status ${res.status} for ${country}/${categoryType}`);
            throw new Error(`FlixPatrol fetch failed with status ${res.status}`);
        }

        const html = await res.text();

        // SEC-11 FIX: Limit HTML size to prevent memory exhaustion from malicious responses
        if (html.length > 5 * 1024 * 1024) {
            console.warn(`[Scraper] FlixPatrol response too large (${(html.length / 1024).toFixed(0)}KB), truncating`);
        }
        const $ = cheerio.load(html.substring(0, 5 * 1024 * 1024));

        const titles = [];
        // PERF-07 FIX: Use a Set for O(1) dedup instead of Array.some() O(n)
        const seenTitles = new Set();

        // Determine which section ID and header text to use based on category type
        const sectionId = categoryType === "Films"
            ? 'toc-netflix-movies'
            : 'toc-netflix-tv-shows';
        const headerText = categoryType === "Films" ? "TOP 10 Movies" : "TOP 10 TV Shows";

        // Strategy 1: Find section by ID (global page structure)
        const section = $(`#${sectionId}`);

        if (section.length > 0) {
            console.log(`[Scraper] Found section #${sectionId} for ${country}/${categoryType}`);
            titles.push(...extractTitlesFromSection($, section, seenTitles, 10));
        }

        // Strategy 2: Find by h3 header inside a .card (country page structure)
        if (titles.length === 0) {
            $('h3').each((i, el) => {
                if (titles.length >= 10) return false;

                const text = $(el).text().trim();
                if (text === headerText) {
                    const card = $(el).closest('.card');
                    if (card.length > 0) {
                        console.log(`[Scraper] Found h3 "${headerText}" in .card for ${country}/${categoryType}`);
                        titles.push(...extractTitlesFromSection($, card, seenTitles, 10));
                    }
                }
            });
        }

        // Strategy 3: Fallback - Find by broader header search
        if (titles.length === 0) {
            const altHeader = categoryType === "Films" ? "TOP Movies" : "TOP TV Shows";

            const headers = $(`h2:contains("${altHeader}"), h3:contains("${altHeader}")`).filter(function () {
                const text = $(this).text().trim();
                return text.includes(altHeader) || text.includes(headerText);
            });

            if (headers.length > 0) {
                console.log(`[Scraper] Found header "${altHeader}" for ${country}/${categoryType}`);
                let container = headers.first().closest('.card');
                if (container.length === 0) container = headers.first().closest('.content, .table-wrapper');
                if (container.length === 0) container = headers.first().parent().parent();

                if (container.length > 0) {
                    titles.push(...extractTitlesFromSection($, container, seenTitles, 10));
                }
            }
        }

        // Strategy 4: Final fallback — collect all title links from the page
        if (titles.length === 0) {
            console.warn(`[Scraper] Primary selectors failed for ${country}/${categoryType}, using global fallback`);
            const allTitles = [];
            $('a[href*="/title/"]').each((i, a) => {
                // SEC-026 FIX: Sanitize text extracted from external HTML
                const title = sanitizeExternalText($(a).text().trim());
                const href = $(a).attr('href') || '';
                const yearMatch = href.match(/-(\d{4})\/?$/);
                const year = yearMatch ? yearMatch[1] : null;

                if (title && !seenTitles.has(title)) {
                    seenTitles.add(title);
                    allTitles.push({ title, year });
                }
            });

            if (allTitles.length > 0) {
                console.warn(`[Scraper] Fallback collected ${allTitles.length} titles (no category distinction) for ${country}/${categoryType}`);
                const count = Math.min(10, allTitles.length);
                titles.push(...allTitles.slice(0, count));
            }
        }

        if (titles.length > 0) {
            console.log(`[Scraper] Found ${titles.length} titles for ${country}/${categoryType}: ${titles.map(t => t.title).join(', ')}`);
            flixpatrolCache.set(cacheKey, titles);
        } else {
            console.error(`[Scraper] No titles found for ${country}/${categoryType}`);
        }
        return titles;
    } catch (err) {
        // REL-02 FIX: Log all errors instead of silently swallowing
        console.error(`[Scraper] FlixPatrol scrape error for ${country}/${categoryType}:`, err.message);
        return [];
    }
}

/**
 * Get the list of available countries.
 * LOG-03 FIX: Uses module-level FLIXPATROL_COUNTRIES import.
 * PERF-04 FIX: Return constant reference directly (no new array per call).
 * PERF-05 FIX: Cached at module level.
 * @returns {string[]}
 */
function getAvailableCountries() {
    // LOG-03 FIX: FLIXPATROL_COUNTRIES already imported at module top level.
    // No require() inside function.
    return FLIXPATROL_COUNTRIES;
}

module.exports = {
    fetchFlixPatrolTitles,
    getAvailableCountries,
};
