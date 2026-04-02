// ============================================================
// Scraper Provider Interface — pluggable scraper architecture
// ============================================================

export interface ScrapedTitle {
    title: string;
    year: string | null;
}

export interface ScraperProvider {
    id: string;
    name: string;
    platforms: string[];
    getAvailableCountries(): string[];
    fetchTop10(categoryType: string, country: string): Promise<ScrapedTitle[]>;
}
