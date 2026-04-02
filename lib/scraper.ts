// ============================================================
// Scraper — Backward compatibility wrapper
// Delegates to the pluggable provider architecture
// Existing imports (fetchFlixPatrolTitles, getAvailableCountries) still work
// ============================================================

import { NetflixProvider } from './providers/index.js';

// Shared singleton instance for backward compatibility
const netflixProvider = new NetflixProvider();

// Re-export the ScrapedTitle type for backward compatibility
export interface ScrapedTitle {
    title: string;
    year: string | null;
}

/**
 * Scrape FlixPatrol for Top 10 Netflix titles.
 * Backward-compatible function signature matching the original scraper.
 * Delegates to NetflixProvider which uses the pluggable provider architecture.
 */
export async function fetchFlixPatrolTitles(
    categoryType: string,
    country: string = 'Global',
): Promise<ScrapedTitle[]> {
    return netflixProvider.fetchTop10(categoryType, country);
}

/**
 * Get the list of available countries for Netflix scraping.
 */
export function getAvailableCountries(): readonly string[] {
    return netflixProvider.getAvailableCountries();
}
