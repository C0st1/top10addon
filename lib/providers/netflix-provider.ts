// ============================================================
// Netflix Provider — thin wrapper around FlixPatrolProvider
// Hardcodes Netflix platform for backward compatibility
// ============================================================

import { FlixPatrolProvider } from './flixpatrol-provider.js';
import { ScraperProvider } from './types.js';

export class NetflixProvider extends FlixPatrolProvider implements ScraperProvider {
    override id = 'netflix';
    override name = 'Netflix Top 10';
    override platforms = ['netflix'];

    async fetchTop10(categoryType: string, country: string = 'Global'): Promise<import('./types.js').ScrapedTitle[]> {
        return super.fetchTop10ForPlatform('netflix', categoryType, country);
    }
}
