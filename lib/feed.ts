// ============================================================
// RSS/Atom Feed Generator
// Generates RSS 2.0 feeds from catalog data
// ============================================================

import { buildCatalog } from './manifest.js';

/**
 * Generate an RSS 2.0 feed for a catalog.
 *
 * @param type - "movie" or "series"
 * @param catalogId - Catalog ID (e.g. "netflix_top10_movies_global")
 * @param apiKey - TMDB API key
 * @param rpdbApiKey - RPDB API key (optional)
 * @param multiCountries - List of countries
 * @param baseUrl - Base URL for the addon
 * @returns RSS 2.0 XML string
 */
export async function generateRSSFeed(
    type: string,
    catalogId: string,
    apiKey: string,
    rpdbApiKey: string | null,
    multiCountries: string[],
    baseUrl: string,
): Promise<string> {
    const metas = await buildCatalog(type, catalogId, apiKey, rpdbApiKey, multiCountries);

    const items = metas
        .map((m, i) => {
            const tmdbId = m.id.startsWith('tmdb:') ? m.id.replace('tmdb:', '') : m.id;
            const typeSlug = m.type === 'series' ? 'tv' : 'movie';
            return `    <item>
      <title>#${i + 1}: ${escapeXml(m.name)}</title>
      <link>https://www.themoviedb.org/${typeSlug}/${tmdbId}</link>
      <description>${escapeXml(m.description || '')}</description>
      ${m.tmdbPoster ? `<enclosure url="${escapeXml(m.tmdbPoster)}" type="image/jpeg"/>` : ''}
    </item>`;
        })
        .join('\n');

    // Parse country name from catalog ID
    const country = parseCountryFromCatalogId(catalogId);
    const typeLabel = type === 'movie' ? 'Movies' : 'TV Shows';

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Netflix Top 10 ${typeLabel} - ${escapeXml(country)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>Current Netflix Top 10 ${typeLabel} rankings for ${escapeXml(country)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Netflix Top 10 Stremio Addon v4.0.0</generator>
    <atom:link href="${escapeXml(baseUrl)}/feed/${type}/${catalogId}.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Parse a human-readable country name from a catalog ID.
 */
function parseCountryFromCatalogId(catalogId: string): string {
    if (catalogId.includes('global')) return 'Global';
    const match = catalogId.match(/^(?:.+?)_top10_(?:movies|series)_(.+)$/);
    if (match) {
        return match[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    return catalogId;
}
