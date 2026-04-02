// ============================================================
// Provider Registry — central registry for scraper providers
// ============================================================

import { ScraperProvider } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'provider-registry' });

class ProviderRegistry {
    private providers: Map<string, ScraperProvider> = new Map();

    /**
     * Register a scraper provider.
     */
    register(provider: ScraperProvider): void {
        this.providers.set(provider.id, provider);
        log.info({ providerId: provider.id, providerName: provider.name }, 'Registered provider');
    }

    /**
     * Get a provider by ID.
     */
    get(id: string): ScraperProvider | undefined {
        return this.providers.get(id);
    }

    /**
     * Get all registered providers.
     */
    getAll(): ScraperProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get the union of all available countries from all registered providers.
     */
    getAvailableCountries(): string[] {
        const countrySet = new Set<string>();
        for (const provider of this.providers.values()) {
            for (const country of provider.getAvailableCountries()) {
                countrySet.add(country);
            }
        }
        return Array.from(countrySet);
    }

    /**
     * Check if a provider is registered.
     */
    has(id: string): boolean {
        return this.providers.has(id);
    }

    /**
     * Get the number of registered providers.
     */
    get size(): number {
        return this.providers.size;
    }
}

export const registry = new ProviderRegistry();
