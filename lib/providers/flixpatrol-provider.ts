// ============================================================
// FlixPatrol Scraper Provider — multi-platform support
// Wraps existing scraping logic into the ScraperProvider interface
// ============================================================

import { ScraperProvider, ScrapedTitle } from './types.js';
import { LRUCache } from '../cache.js';
import { fetchWithTimeout, getFlixPatrolSlug } from '../utils.js';
import { DEFAULTS, FLIXPATROL_COUNTRIES } from '../constants.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'flixpatrol-provider' });

export class FlixPatrolProvider implements ScraperProvider {
    id = 'flixpatrol';
    name = 'FlixPatrol';
    platforms = ['netflix', 'prime-video', 'disney-plus', 'hbo-max', 'apple-tv-plus', 'hulu'];

    private cache: LRUCache<ScrapedTitle[]>;

    constructor() {
        this.cache = new LRUCache<ScrapedTitle[]>({
            maxSize: DEFAULTS.CACHE_MAX_FLIXPATROL,
            ttl: DEFAULTS.CACHE_TTL,
        });
    }

    getAvailableCountries(): string[] {
        return [...FLIXPATROL_COUNTRIES];
    }

    async fetchTop10(categoryType: string, country: string = 'Global', platform: string = 'netflix'): Promise<ScrapedTitle[]> {
        const slug = getFlixPatrolSlug(country);
        const cacheKey = `flixpatrol_${platform}_${slug}_${categoryType}`;
        const cached = this.cache.get(cacheKey);
        if (cached.data && !cached.stale) return cached.data;

        try {
            const url = `https://flixpatrol.com/top10/${platform}/${slug}/`;
            const opts = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            };
            const res = await fetchWithTimeout(url, opts, DEFAULTS.FLIXPATROL_TIMEOUT);
            if (!res.ok) {
                log.warn({ status: res.status, platform, country, categoryType }, 'FlixPatrol returned non-OK status');
                throw new Error(`FlixPatrol fetch failed with status ${res.status}`);
            }

            const html = await res.text();
            const titles = this.parseTitlesFromHtml(html, categoryType, platform, country);

            if (titles.length > 0) {
                this.cache.set(cacheKey, titles);
            } else {
                log.error({ platform, country, categoryType }, 'No titles found');
            }
            return titles;
        } catch (err: unknown) {
            log.error({ err: err as Error, platform, country, categoryType }, 'Scrape error');
            return [];
        }
    }

    /**
     * Fetch Top 10 for a specific platform — used by sub-classes.
     */
    async fetchTop10ForPlatform(platform: string, categoryType: string, country: string = 'Global'): Promise<ScrapedTitle[]> {
        return this.fetchTop10(categoryType, country, platform);
    }

    /**
     * Get the cache size (for health reporting).
     */
    getCacheSize(): number {
        return this.cache.size;
    }

    /**
     * Parse titles from FlixPatrol HTML using two strategies.
     * Strategy 1: Find category header and extract from nearest container.
     * Strategy 2: Fallback — collect all title links from the page.
     */
    private parseTitlesFromHtml(html: string, categoryType: string, platform: string, country: string): ScrapedTitle[] {
        // Dynamic import cheerio (it's a CommonJS module)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);
        const titles: ScrapedTitle[] = [];
        const targetHeader = categoryType === 'Films' ? 'TOP 10 Movies' : 'TOP 10 TV Shows';

        // Strategy 1: Find header text and extract from nearest container
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headers = $(`:contains("${targetHeader}")`).filter(function (this: any) {
            return $(this).children().length === 0;
        });

        if (headers.length > 0) {
            let container = headers.first().closest('table');
            if (container.length === 0) container = headers.first().closest('div').nextAll('table').first();
            if (container.length === 0) container = headers.first().closest('.card, .table-wrapper, div[class*="flex"], div[class*="grid"]');

            if (container.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                container.find('a[href*="/title/"]').each((_i: any, a: any) => {
                    const title = $(a).text().trim();
                    const href = $(a).attr('href') || '';
                    const yearMatch = href.match(/-(\d{4})\/?$/);
                    const year = yearMatch ? yearMatch[1] : null;

                    if (title && !titles.some(t => t.title === title) && titles.length < 10) {
                        titles.push({ title, year });
                    }
                });
            }
        }

        // Strategy 2: Fallback — collect all title links from the page
        if (titles.length === 0) {
            log.warn({ platform, country, categoryType }, 'Primary selector failed, using fallback');
            const allTitles: ScrapedTitle[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            $('a[href*="/title/"]').each((_i: any, a: any) => {
                const title = $(a).text().trim();
                const href = $(a).attr('href') || '';
                const yearMatch = href.match(/-(\d{4})\/?$/);
                const year = yearMatch ? yearMatch[1] : null;

                if (title && !allTitles.some(t => t.title === title)) {
                    allTitles.push({ title, year });
                }
            });
            if (allTitles.length > 0) {
                log.warn({ count: allTitles.length, platform, country, categoryType }, 'Fallback collected titles with no category distinction');
                const count = Math.min(10, allTitles.length);
                titles.push(...allTitles.slice(0, count));
            }
        }

        return titles;
    }
}
