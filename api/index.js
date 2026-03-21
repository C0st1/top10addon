// ============================================================
// Netflix Top 10 — Stremio Addon (Vercel / Node.js) — v3.1
// ============================================================

// --- GENERIC CACHE WITH TTL + STALE-WHILE-REVALIDATE ---
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return { data: null, stale: false };
    const isStale = Date.now() - entry.timestamp > CACHE_TTL;
    return { data: entry.data, stale: isStale };
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

function getCacheSize() {
    return cache.size;
}

// --- IMDB ID CACHE ---
const imdbCache = new Map();

function getImdbCacheKey(type, tmdbId) {
    return `${type}_${tmdbId}`;
}

// --- TSV STRUCTURED CACHE ---
let parsedTsvCache = {
    parsed: null,
    tsvTimestamp: 0,
};

let rawTsvCache = { data: "", timestamp: 0 };
const TSV_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

function getTsvTimestamp() {
    return rawTsvCache.timestamp;
}

async function fetchRawTSV() {
    if (rawTsvCache.data && Date.now() - rawTsvCache.timestamp < TSV_CACHE_TTL) {
        return rawTsvCache.data;
    }
    try {
        const url = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv";
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!response.ok) {
            console.error(`TSV fetch failed: ${response.status}`);
            return rawTsvCache.data || "";
        }
        const data = await response.text();
        rawTsvCache = { data, timestamp: Date.now() };
        parsedTsvCache = { parsed: null, tsvTimestamp: 0 };
        return data;
    } catch (err) {
        console.error("TSV fetch error:", err.message);
        return rawTsvCache.data || "";
    }
}

function parseTSV(raw) {
    const lines = raw.split("\n");
    if (lines.length < 2) return { countries: [], data: {}, globalLatestWeek: "" };

    const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());
    const countryIdx = headers.indexOf("country_name");
    const weekIdx = headers.indexOf("week");
    const categoryIdx = headers.indexOf("category");
    const rankIdx = headers.indexOf("weekly_rank");
    const titleIdx = headers.indexOf("show_title");

    const ci = countryIdx >= 0 ? countryIdx : 0;
    const wi = weekIdx >= 0 ? weekIdx : 2;
    const cati = categoryIdx >= 0 ? categoryIdx : 3;
    const ri = rankIdx >= 0 ? rankIdx : 4;
    const ti = titleIdx >= 0 ? titleIdx : 5;

    const minCols = Math.max(ci, wi, cati, ri, ti) + 1;
    const countriesSet = new Set();
    const data = {};
    let globalLatestWeek = "";

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < minCols) continue;

        const country = cols[ci].trim();
        const week = cols[wi].trim();
        const category = cols[cati].trim();
        const rank = parseInt(cols[ri]?.trim(), 10) || 99;
        const title = cols[ti].trim();

        if (!country || !week || !category || !title) continue;

        countriesSet.add(country);

        if (!data[country]) data[country] = {};
        if (!data[country][category]) data[country][category] = {};
        if (!data[country][category][week]) data[country][category][week] = { titles: [] };

        data[country][category][week].titles.push({ title, rank });

        if (week > globalLatestWeek) globalLatestWeek = week;
    }

    for (const country of Object.keys(data)) {
        for (const category of Object.keys(data[country])) {
            const weeks = Object.keys(data[country][category]).filter((k) => k !== "latestWeek");
            if (weeks.length > 0) {
                weeks.sort();
                data[country][category].latestWeek = weeks[weeks.length - 1];
            }
        }
    }

    const countries = [...countriesSet].sort();
    return { countries, data, globalLatestWeek };
}

async function getParsedTSV() {
    const raw = await fetchRawTSV();
    if (!raw) {
        return parsedTsvCache.parsed || { countries: [], data: {}, globalLatestWeek: "" };
    }
    if (!parsedTsvCache.parsed || parsedTsvCache.tsvTimestamp !== rawTsvCache.timestamp) {
        parsedTsvCache = {
            parsed: parseTSV(raw),
            tsvTimestamp: rawTsvCache.timestamp,
        };
    }
    return parsedTsvCache.parsed;
}

let cachedCountries = {
    list: [],
    tsvTimestamp: 0,
};

const FALLBACK_COUNTRIES = [
    "Argentina", "Australia", "Austria", "Bahamas", "Belgium", "Bolivia",
    "Brazil", "Bulgaria", "Canada", "Chile", "Colombia", "Costa Rica",
    "Croatia", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador",
    "Egypt", "El Salvador", "Estonia", "Finland", "France", "Germany",
    "Greece", "Guatemala", "Honduras", "Hungary", "Iceland", "India",
    "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Kenya", "Latvia",
    "Lithuania", "Luxembourg", "Malta", "Mexico", "Netherlands", "New Zealand",
    "Nicaragua", "Nigeria", "Norway", "Pakistan", "Panama", "Paraguay",
    "Peru", "Philippines", "Poland", "Portugal", "Romania", "Saudi Arabia",
    "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea",
    "Spain", "Sweden", "Switzerland", "Thailand", "Trinidad and Tobago",
    "Turkey", "Ukraine", "United Kingdom", "United States", "Uruguay",
    "Venezuela", "Vietnam",
];

async function getAvailableCountries() {
    const parsed = await getParsedTSV();
    if (cachedCountries.list.length > 0 && cachedCountries.tsvTimestamp === rawTsvCache.timestamp) {
        return cachedCountries.list;
    }
    const list = parsed.countries.length > 0 ? parsed.countries : FALLBACK_COUNTRIES;
    cachedCountries = { list, tsvTimestamp: rawTsvCache.timestamp };
    return list;
}

const TITLE_OVERRIDES = {
    "The Race": "tt35052447",
};

function getRpdbPosterUrl(imdbId, rpdbApiKey) {
    if (!rpdbApiKey || !imdbId || !imdbId.startsWith("tt")) return null;
    return `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
}

async function throttledMap(items, fn, concurrency = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

async function fetchNetflixTitles(categoryType, country = "Romania") {
    try {
        const parsed = await getParsedTSV();
        const countryData = parsed.data[country];
        if (!countryData || !countryData[categoryType]) return [];

        const catData = countryData[categoryType];
        const latestWeek = catData.latestWeek;
        if (!latestWeek || !catData[latestWeek]) return [];

        const entries = catData[latestWeek].titles.slice().sort((a, b) => a.rank - b.rank);
        const seen = new Set();
        const result = [];
        for (const e of entries) {
            if (!seen.has(e.title)) {
                seen.add(e.title);
                result.push(e.title);
            }
            if (result.length >= 10) break;
        }
        return result;
    } catch (err) {
        console.error("fetchNetflixTitles error:", err.message);
        return [];
    }
}

async function getTrendForTitle(title, categoryType, country) {
    try {
        const parsed = await getParsedTSV();
        const countryData = parsed.data[country];
        if (!countryData || !countryData[categoryType]) return null;

        const catData = countryData[categoryType];
        const weeks = Object.keys(catData).filter((k) => k !== "latestWeek").sort();
        if (weeks.length < 1) return null;

        const latestWeek = weeks[weeks.length - 1];
        const prevWeek = weeks.length >= 2 ? weeks[weeks.length - 2] : null;

        const latestEntry = catData[latestWeek]?.titles.find((t) => t.title === title);
        if (!latestEntry) return null;

        if (!prevWeek || !catData[prevWeek]) return { indicator: "🆕", detail: "New this week" };

        const prevEntry = catData[prevWeek]?.titles.find((t) => t.title === title);
        if (!prevEntry) return { indicator: "🆕", detail: "New this week" };

        const diff = prevEntry.rank - latestEntry.rank;
        if (diff > 0) return { indicator: "🔺", detail: `Up ${diff} spot${diff > 1 ? "s" : ""}` };
        if (diff < 0) return { indicator: "🔻", detail: `Down ${Math.abs(diff)} spot${Math.abs(diff) > 1 ? "s" : ""}` };
        return { indicator: "➖", detail: "No change" };
    } catch {
        return null;
    }
}

async function fetchGlobalTitles(categoryType) {
    try {
        const parsed = await getParsedTSV();
        const titleCounts = new Map();

        for (const country of Object.keys(parsed.data)) {
            const catData = parsed.data[country][categoryType];
            if (!catData) continue;
            const latestWeek = catData.latestWeek;
            if (!latestWeek || !catData[latestWeek]) continue;

            const seen = new Set();
            for (const entry of catData[latestWeek].titles) {
                if (seen.has(entry.title)) continue;
                seen.add(entry.title);
                const existing = titleCounts.get(entry.title) || { count: 0, totalRank: 0 };
                existing.count++;
                existing.totalRank += entry.rank;
                titleCounts.set(entry.title, existing);
            }
        }

        const sorted = [...titleCounts.entries()].sort((a, b) => {
            if (b[1].count !== a[1].count) return b[1].count - a[1].count;
            return a[1].totalRank / a[1].count - b[1].totalRank / b[1].count;
        });

        return sorted.slice(0, 10).map(([title]) => title);
    } catch (err) {
        console.error("fetchGlobalTitles error:", err.message);
        return [];
    }
}

async function matchTMDB(title, type, apiKey, rpdbApiKey, categoryType, country) {
    if (!apiKey) return null;
    try {
        const cleanTitle = title.replace(/: Season \d+/gi, "").replace(/ - Season \d+/gi, "").trim();

        if (TITLE_OVERRIDES[cleanTitle]) {
            const overrideId = TITLE_OVERRIDES[cleanTitle];
            const findUrl = `https://api.themoviedb.org/3/find/${overrideId}?api_key=${apiKey}&external_source=imdb_id`;
            const response = await fetch(findUrl);
            if (!response.ok) return null;
            const findData = await response.json();
            const results = type === "tv" ? findData.tv_results : findData.movie_results;
            if (results && results.length > 0) {
                const meta = formatMeta(results[0], overrideId, type, rpdbApiKey);
                if (categoryType && country) {
                    const trend = await getTrendForTitle(title, categoryType, country);
                    if (trend) appendTrend(meta, trend);
                }
                return meta;
            }
        }

        const searchUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}&language=en-US&page=1`;
        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return null;
        const searchData = await searchResponse.json();

        if (searchData.results && searchData.results.length > 0) {
            const candidates = searchData.results.slice(0, 5);
            const exactMatches = candidates.filter((item) => {
                const itemTitle = type === "tv" ? item.name : item.title;
                const originalTitle = type === "tv" ? item.original_name : item.original_title;
                return ((itemTitle && itemTitle.toLowerCase() === cleanTitle.toLowerCase()) || (originalTitle && originalTitle.toLowerCase() === cleanTitle.toLowerCase()));
            });

            let bestMatch;
            if (exactMatches.length > 0) {
                bestMatch = exactMatches.sort((a, b) => {
                    const dateA = new Date(a.release_date || a.first_air_date || "1900-01-01");
                    const dateB = new Date(b.release_date || b.first_air_date || "1900-01-01");
                    return dateB.getTime() - dateA.getTime();
                })[0];
            } else {
                bestMatch = candidates[0];
            }

            let finalId = `tmdb:${bestMatch.id}`;
            const cacheKey = getImdbCacheKey(type, bestMatch.id);
            if (imdbCache.has(cacheKey)) {
                finalId = imdbCache.get(cacheKey);
            } else {
                try {
                    const extUrl = `https://api.themoviedb.org/3/${type}/${bestMatch.id}?api_key=${apiKey}&append_to_response=external_ids`;
                    const extResponse = await fetch(extUrl);
                    if (extResponse.ok) {
                        const extData = await extResponse.json();
                        const imdbId = extData.external_ids?.imdb_id || extData.imdb_id;
                        if (imdbId) {
                            finalId = imdbId;
                            imdbCache.set(cacheKey, imdbId);
                        }
                    }
                } catch (extErr) {
                    console.error("TMDB external_ids error:", extErr.message);
                }
            }

            const meta = formatMeta(bestMatch, finalId, type, rpdbApiKey);

            if (categoryType && country) {
                const trend = await getTrendForTitle(title, categoryType, country);
                if (trend) appendTrend(meta, trend);
            }

            return meta;
        }
    } catch (err) {
        console.error(`TMDB match error for "${title}":`, err.message);
    }
    return null;
}

function appendTrend(meta, trend) {
    const desc = meta.description || "";
    meta.description = `${trend.indicator} ${trend.detail}\n\n${desc}`;
}

function formatMeta(item, finalId, type, rpdbApiKey) {
    const tmdbPoster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
    const rpdbPoster = getRpdbPosterUrl(finalId, rpdbApiKey);
    const poster = rpdbPoster || tmdbPoster;

    return {
        id: finalId,
        type: type === "tv" ? "series" : "movie",
        name: item.title || item.name,
        poster,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || "",
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
    };
}

function buildManifest(country = "Romania", multiCountries = [], includeGlobal = false) {
    const safeCountry = country.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "Romania";
    const countrySlug = safeCountry.toLowerCase().replace(/\s+/g, "_");

    const displayName = multiCountries.length > 1
        ? multiCountries.slice(0, 3).join(", ") + (multiCountries.length > 3 ? "…" : "")
        : safeCountry;

    const idSlug = multiCountries.length > 1 ? "multi" : countrySlug;

    const catalogs = [
        {
            type: "movie",
            id: `netflix_top10_movies_${idSlug}`,
            name: `Netflix Top 10 Movies (${displayName})`,
        },
        {
            type: "series",
            id: `netflix_top10_series_${idSlug}`,
            name: `Netflix Top 10 TV Shows (${displayName})`,
        }
    ];

    if (includeGlobal) {
        catalogs.push({
            type: "movie",
            id: "netflix_top10_movies_global",
            name: "Netflix Top 10 Movies (Global)",
        });
        catalogs.push({
            type: "series",
            id: "netflix_top10_series_global",
            name: "Netflix Top 10 TV Shows (Global)",
        });
    }

    let description = `Weekly updated Top 10 Movies and TV Shows on Netflix — ${displayName}.`;
    if (includeGlobal) description += " Includes Global charts.";

    return {
        id: `org.stremio.netflixtop10.${idSlug}`,
        version: "3.1.0",
        name: `Netflix Top 10 (${displayName})`,
        description,
        logo: "https://img.icons8.com/color/256/netflix.png",
        types: ["movie", "series"],
        catalogs,
        resources: ["catalog"],
        behaviorHints: { configurable: true },
        config: [
            { key: "tmdbApiKey", type: "text", title: "TMDB API Key", required: true },
            { key: "rpdbApiKey", type: "text", title: "RPDB API Key (Optional)", required: false },
            { key: "country", type: "text", title: "Country (comma-separated for multi)", required: false },
            { key: "includeGlobal", type: "boolean", title: "Include Global Catalogs", required: false }
        ],
    };
}

async function buildCatalog(
    type,
    catalogId,
    apiKey,
    rpdbApiKey,
    country,
    multiCountries
) {
    const rpdbSuffix = rpdbApiKey || "no_rpdb";
    const countriesKey = multiCountries.length > 1 ? multiCountries.sort().join("+") : country;
    const cacheKey = `${type}_${catalogId}_${countriesKey}_${rpdbSuffix}`;

    const cached = getCached(cacheKey);
    if (cached.data && !cached.stale) return cached.data;

    if (cached.data && cached.stale) {
        refreshCatalogInBackground(cacheKey, type, catalogId, apiKey, rpdbApiKey, country, multiCountries);
        return cached.data;
    }

    return await fetchCatalogFresh(cacheKey, type, catalogId, apiKey, rpdbApiKey, country, multiCountries);
}

function refreshCatalogInBackground(
    cacheKey, type, catalogId,
    apiKey, rpdbApiKey, country, multiCountries
) {
    fetchCatalogFresh(cacheKey, type, catalogId, apiKey, rpdbApiKey, country, multiCountries).catch(
        (err) => console.error("Background refresh error:", err)
    );
}

async function fetchCatalogFresh(
    cacheKey, type, catalogId,
    apiKey, rpdbApiKey, country, multiCountries
) {
    const isGlobal = catalogId.endsWith("_global");
    const tmdbType = type === "movie" ? "movie" : "tv";
    const categoryType = type === "movie" ? "Films" : "TV";

    let titles = [];

    if (isGlobal) {
        titles = await fetchGlobalTitles(categoryType);
    } else if (multiCountries.length > 1) {
        const allTitles = new Map();
        for (const c of multiCountries) {
            const countryTitles = await fetchNetflixTitles(categoryType, c);
            countryTitles.forEach((t, idx) => {
                const existing = allTitles.get(t) || { count: 0, bestRank: 99 };
                existing.count++;
                existing.bestRank = Math.min(existing.bestRank, idx + 1);
                allTitles.set(t, existing);
            });
        }
        titles = [...allTitles.entries()]
            .sort((a, b) => b[1].count - a[1].count || a[1].bestRank - b[1].bestRank)
            .slice(0, 10)
            .map(([t]) => t);
    } else {
        titles = await fetchNetflixTitles(categoryType, country);
    }

    if (titles.length === 0) return [];

    const trendCountry = isGlobal ? "" : (multiCountries.length > 1 ? multiCountries[0] : country);
    const results = await throttledMap(
        titles,
        (title) => matchTMDB(title, tmdbType, apiKey, rpdbApiKey, categoryType, trendCountry || undefined),
        3
    );

    const metas = results
        .filter((r) => r.status === "fulfilled" && r.value)
        .map((r) => r.value);

    if (metas.length > 0) setCache(cacheKey, metas);
    return metas;
}

async function getLatestWeekDate() {
    const parsed = await getParsedTSV();
    return parsed.globalLatestWeek || "Unknown";
}

async function validateTmdbKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
        return { valid: false, message: "API key is empty." };
    }
    try {
        const testUrl = `https://api.themoviedb.org/3/configuration?api_key=${apiKey.trim()}`;
        const resp = await fetch(testUrl);
        if (resp.ok) return { valid: true, message: "API key is valid!" };
        if (resp.status === 401) return { valid: false, message: "Invalid API key (401 Unauthorized)." };
        return { valid: false, message: `TMDB returned status ${resp.status}.` };
    } catch (err) {
        return { valid: false, message: `Network error: ${err.message}` };
    }
}
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function parseConfig(configStr) {
    try {
        const config = JSON.parse(decodeURIComponent(configStr));
        if (!config || typeof config.tmdbApiKey !== "string" || config.tmdbApiKey.trim().length === 0) {
            return null;
        }
        const rawCountry = config.country || "Romania";
        const multiCountries = rawCountry
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        return {
            tmdbApiKey: config.tmdbApiKey.trim(),
            rpdbApiKey: config.rpdbApiKey?.trim() || null,
            country: multiCountries[0] || "Romania",
            multiCountries,
            includeGlobal: config.includeGlobal === true,
        };
    } catch {
        return null;
    }
}

async function buildConfigHTML(countries, latestWeek) {
    const countryOptions = countries
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Netflix Top 10 — Stremio Addon</title>
    <meta name="description" content="Configure your personalized Netflix Top 10 Stremio addon with country selection, TMDB metadata, and optional RPDB rating posters.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --red: #e50914;
            --red-dim: #b0060f;
            --bg: #0a0a0a;
            --surface: #111111;
            --surface2: #1a1a1a;
            --border: #2a2a2a;
            --text: #f0f0f0;
            --muted: #777;
            --success: #2ecc71;
            --warning: #f39c12;
        }

        html { scroll-behavior: smooth; }

        body {
            font-family: 'DM Sans', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
        }

        body::before {
            content: '';
            position: fixed;
            top: -200px;
            left: 50%;
            transform: translateX(-50%);
            width: 800px;
            height: 400px;
            background: radial-gradient(ellipse, rgba(229,9,20,0.12) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
        }

        .card {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 480px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
        }

        .card-header {
            background: linear-gradient(135deg, #1a0000 0%, #1a0505 50%, #0a0a0a 100%);
            padding: 36px 36px 28px;
            border-bottom: 1px solid var(--border);
            position: relative;
            overflow: hidden;
        }

        .card-header::after {
            content: '';
            position: absolute;
            bottom: 0; left: 0; right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--red), transparent);
            opacity: 0.5;
        }

        .logo-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }

        .logo-n {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 38px;
            color: var(--red);
            line-height: 1;
            letter-spacing: -1px;
        }

        .logo-badge {
            background: var(--red);
            color: #fff;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            padding: 4px 8px;
            border-radius: 4px;
        }

        .card-header h1 {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 28px;
            letter-spacing: 1px;
            color: var(--text);
            line-height: 1.1;
        }

        .card-header p {
            font-size: 13px;
            color: var(--muted);
            margin-top: 6px;
            line-height: 1.5;
        }

        .week-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 10px;
            padding: 4px 10px;
            background: rgba(229,9,20,0.1);
            border: 1px solid rgba(229,9,20,0.2);
            border-radius: 6px;
            font-size: 11px;
            color: #e57373;
            letter-spacing: 0.3px;
        }

        .week-badge svg { flex-shrink: 0; }

        .card-body { padding: 28px 36px 36px; }

        .field { margin-bottom: 20px; }

        .field label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 8px;
        }

        .field label .required-dot {
            width: 5px; height: 5px;
            background: var(--red);
            border-radius: 50%;
            display: inline-block;
        }

        .field label .optional-tag {
            font-size: 10px;
            background: var(--surface2);
            border: 1px solid var(--border);
            color: var(--muted);
            padding: 1px 6px;
            border-radius: 3px;
            letter-spacing: 0.5px;
        }

        input[type="text"], select {
            width: 100%;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text);
            font-family: 'DM Sans', sans-serif;
            font-size: 14px;
            padding: 12px 14px;
            transition: border-color 0.2s, box-shadow 0.2s;
            outline: none;
            -webkit-appearance: none;
        }

        input[type="text"]:focus, select:focus {
            border-color: var(--red);
            box-shadow: 0 0 0 3px rgba(229,9,20,0.15);
        }

        input::placeholder { color: #444; }

        select {
            cursor: pointer;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 14px center;
            padding-right: 36px;
        }

        select option { background: #1a1a1a; }

        .toggle-field {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 15px;
            margin-bottom: 20px;
        }

        .toggle-field label {
            margin-bottom: 0;
            cursor: pointer;
            text-transform: none;
            letter-spacing: normal;
            font-weight: 500;
            font-size: 13px;
            color: var(--text);
        }

        /* Checkbox styling */
        input[type="checkbox"] {
            appearance: none;
            -webkit-appearance: none;
            background-color: var(--surface2);
            border: 1px solid var(--border);
            border-radius: 4px;
            width: 18px;
            height: 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: 0.2s;
        }

        input[type="checkbox"]:checked {
            background-color: var(--red);
            border-color: var(--red);
        }

        input[type="checkbox"]:checked::after {
            content: '\\2714';
            font-size: 12px;
            color: white;
        }

        .hint {
            font-size: 11.5px;
            color: var(--muted);
            margin-top: 6px;
            line-height: 1.4;
        }

        .hint a { color: #6699cc; text-decoration: none; }
        .hint a:hover { text-decoration: underline; }

        .divider { border: none; border-top: 1px solid var(--border); margin: 24px 0; }

        .multi-countries {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
            min-height: 0;
        }

        .country-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: rgba(229,9,20,0.1);
            border: 1px solid rgba(229,9,20,0.25);
            border-radius: 20px;
            font-size: 12px;
            color: #e0e0e0;
            animation: fadeIn 0.2s ease;
        }

        .country-tag .remove-tag {
            cursor: pointer;
            color: #999;
            font-size: 14px;
            line-height: 1;
            margin-left: 2px;
            transition: color 0.15s;
        }

        .country-tag .remove-tag:hover { color: var(--red); }

        @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
        }

        .btn {
            display: block;
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-family: 'DM Sans', sans-serif;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.18s ease;
            letter-spacing: 0.3px;
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
        }

        .btn-primary { background: var(--red); color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #f40612; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(229,9,20,0.35); }
        .btn-primary:active:not(:disabled) { transform: translateY(0); }

        .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); margin-top: 10px; }
        .btn-secondary:hover:not(:disabled) { background: #222; border-color: #444; }

        .btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); margin-top: 10px; font-size: 13px; }
        .btn-ghost:hover { color: var(--text); border-color: #555; }

        .btn-sm { display: inline-block; width: auto; padding: 8px 14px; font-size: 12px; margin-top: 6px; }

        .btn-test { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
        .btn-test:hover:not(:disabled) { border-color: #555; color: var(--text); }

        .key-status {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            margin-left: 8px;
            vertical-align: middle;
        }

        .key-status.valid { color: var(--success); }
        .key-status.invalid { color: var(--red); }

        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
            vertical-align: middle;
            margin-right: 6px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        #resultArea { display: none; margin-top: 24px; animation: slideIn 0.3s ease; }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .result-label { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }

        .url-box {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 14px;
            margin-bottom: 10px;
        }

        .url-box-text {
            flex: 1;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #5dade2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .copy-btn {
            flex-shrink: 0;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 5px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 600;
            padding: 5px 10px;
            cursor: pointer;
            transition: all 0.15s;
            letter-spacing: 0.3px;
        }

        .copy-btn:hover { color: var(--text); border-color: #555; }
        .copy-btn.copied { color: var(--success); border-color: var(--success); }

        .toast {
            display: none;
            align-items: center;
            gap: 8px;
            background: rgba(46, 204, 113, 0.1);
            border: 1px solid rgba(46, 204, 113, 0.3);
            border-radius: 6px;
            padding: 10px 14px;
            font-size: 13px;
            color: var(--success);
            margin-top: 8px;
        }

        .toast.show { display: flex; }

        .info-box {
            background: rgba(243,156,18,0.07);
            border: 1px solid rgba(243,156,18,0.2);
            border-radius: 8px;
            padding: 12px 14px;
            margin-top: 8px;
            font-size: 12px;
            color: #c8a04a;
            line-height: 1.5;
        }

        .info-box strong { color: var(--warning); }

        .card-footer {
            padding: 16px 36px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-footer span { font-size: 11px; color: #3a3a3a; }
        .card-footer a { font-size: 11px; color: #3a3a3a; text-decoration: none; }
        .card-footer a:hover { color: var(--muted); }

        @media (max-width: 520px) {
            .card-header, .card-body { padding-left: 24px; padding-right: 24px; }
            .card-footer { padding-left: 24px; padding-right: 24px; }
        }

        @keyframes shake {
            0%,100% { transform: translateX(0); }
            20% { transform: translateX(-6px); }
            40% { transform: translateX(6px); }
            60% { transform: translateX(-4px); }
            80% { transform: translateX(4px); }
        }
    </style>
</head>
<body>
<div class="card">
    <div class="card-header">
        <div class="logo-row">
            <span class="logo-n">N</span>
            <span class="logo-badge">Stremio Addon</span>
        </div>
        <h1>Netflix Top 10</h1>
        <p>Configure your personalized Top 10 catalog with country selection, TMDB metadata and optional RPDB rating posters.</p>
        <div class="week-badge" id="weekBadge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span>Data from week of <strong id="latestWeekDisplay">${latestWeek}</strong></span>
        </div>
    </div>

    <div class="card-body">
        <div class="field">
            <label>
                <span class="required-dot"></span>
                Country
                <span class="optional-tag">multi-select</span>
            </label>
            <input type="text" id="countryInput" list="countriesList" placeholder="Search and add countries..." autocomplete="off" spellcheck="false">
            <datalist id="countriesList">
                ${countryOptions}
            </datalist>
            <div class="multi-countries" id="selectedCountries"></div>
            <p class="hint">Type to search. Select multiple countries to merge catalogs. At least one required.</p>
        </div>

        <div class="field">
            <label>
                <span class="required-dot"></span>
                TMDB API Key
            </label>
            <input type="text" id="tmdbKey" placeholder="e.g. 8a7f3bc2d1..." autocomplete="off" spellcheck="false">
            <div style="display:flex;align-items:center;gap:4px;margin-top:6px;">
                <button class="btn btn-sm btn-test" id="testKeyBtn" onclick="testTmdbKey()">Test Key</button>
                <span class="key-status" id="keyStatus"></span>
            </div>
            <p class="hint">Free key available at <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org</a> — required for metadata &amp; posters.</p>
        </div>

        <div class="field">
            <label>
                RPDB API Key
                <span class="optional-tag">optional</span>
            </label>
            <input type="text" id="rpdbKey" placeholder="e.g. t1-xxxxxx..." autocomplete="off" spellcheck="false">
            <p class="hint">Replaces standard posters with <strong style="color:#e0a030">rating overlay posters</strong>. Get a key at <a href="https://ratingposterdb.com/api-key/" target="_blank">ratingposterdb.com</a> (paid, from $2/mo).</p>
            <div class="info-box">
                <strong>RPDB Note:</strong> Only works when the item has an IMDB ID. Titles with fewer than 500 IMDB votes may not have rated posters yet.
            </div>
        </div>

        <div class="toggle-field">
            <input type="checkbox" id="includeGlobalChk">
            <label for="includeGlobalChk">Include Global Top 10 Catalogs</label>
        </div>

        <button class="btn btn-primary" id="generateBtn" onclick="generateLink()">Generate Install Link</button>

        <div id="resultArea">
            <hr class="divider">
            <p class="result-label">Manifest URL (for AIOStreams / manual install)</p>
            <div class="url-box">
                <span class="url-box-text" id="manifestDisplayUrl"></span>
                <button class="copy-btn" id="copyBtn" onclick="copyLink()">Copy</button>
            </div>
            <div class="toast" id="copyToast">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Copied to clipboard!
            </div>
            <button class="btn btn-secondary" onclick="installDirectly()">▶ &nbsp;Install to Stremio</button>
            <button class="btn btn-ghost" onclick="openManifest()">Open manifest.json</button>
        </div>
    </div>

    <div class="card-footer">
        <span>v3.1 — Hosted on Vercel</span>
        <a href="https://www.netflix.com/tudum/top10" target="_blank">Data: Netflix Tudum ↗</a>
    </div>
</div>

<script>
    let currentStremioUrl = "";
    let currentManifestUrl = "";
    const selectedCountriesList = [];

    (function restorePreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem('nf_top10_config') || '{}');
            if (saved.tmdbKey) document.getElementById('tmdbKey').value = saved.tmdbKey;
            if (saved.rpdbKey) document.getElementById('rpdbKey').value = saved.rpdbKey;
            if (saved.includeGlobal !== undefined) document.getElementById('includeGlobalChk').checked = saved.includeGlobal;
            
            if (saved.countries && Array.isArray(saved.countries)) {
                saved.countries.forEach(c => addCountryTag(c));
            } else {
                addCountryTag('Romania');
            }
        } catch {
            addCountryTag('Romania');
        }
    })();

    const countryInput = document.getElementById('countryInput');

    countryInput.addEventListener('change', function() {
        const val = this.value.trim();
        if (val && !selectedCountriesList.includes(val)) {
            const options = document.getElementById('countriesList').options;
            let valid = false;
            for (let i = 0; i < options.length; i++) {
                if (options[i].value === val) { valid = true; break; }
            }
            if (valid) {
                addCountryTag(val);
            }
        }
        this.value = '';
    });

    countryInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.dispatchEvent(new Event('change'));
        }
    });

    function addCountryTag(country) {
        if (selectedCountriesList.includes(country)) return;
        selectedCountriesList.push(country);
        renderCountryTags();
    }

    function removeCountryTag(country) {
        const idx = selectedCountriesList.indexOf(country);
        if (idx >= 0) selectedCountriesList.splice(idx, 1);
        renderCountryTags();
    }

    function renderCountryTags() {
        const container = document.getElementById('selectedCountries');
        container.innerHTML = selectedCountriesList.map(c =>
            '<span class="country-tag">' + c +
            ' <span class="remove-tag" onclick="removeCountryTag(\\'' + c.replace(/'/g, "\\\\'") + '\\')">&times;</span></span>'
        ).join('');
    }

    async function testTmdbKey() {
        const key = document.getElementById('tmdbKey').value.trim();
        const statusEl = document.getElementById('keyStatus');
        const btn = document.getElementById('testKeyBtn');
        if (!key) { shake(document.getElementById('tmdbKey')); return; }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Testing...';
        statusEl.textContent = '';
        statusEl.className = 'key-status';

        try {
            const resp = await fetch('/api/index.js/validate-tmdb-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            const data = await resp.json();
            statusEl.textContent = data.valid ? '✅ ' + data.message : '❌ ' + data.message;
            statusEl.className = 'key-status ' + (data.valid ? 'valid' : 'invalid');
        } catch {
            statusEl.textContent = '❌ Network error';
            statusEl.className = 'key-status invalid';
        }

        btn.disabled = false;
        btn.textContent = 'Test Key';
    }

    function generateLink() {
        const tmdbKey = document.getElementById('tmdbKey').value.trim();
        const rpdbKey = document.getElementById('rpdbKey').value.trim();
        const includeGlobal = document.getElementById('includeGlobalChk').checked;
        const countries = selectedCountriesList.length > 0 ? selectedCountriesList : ['Romania'];

        if (!tmdbKey) { shake(document.getElementById('tmdbKey')); return; }

        const btn = document.getElementById('generateBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Generating...';

        try {
            localStorage.setItem('nf_top10_config', JSON.stringify({
                tmdbKey, rpdbKey, countries, includeGlobal
            }));
        } catch {}

        setTimeout(() => {
            const config = { tmdbApiKey: tmdbKey, country: countries.join(',') };
            if (rpdbKey) config.rpdbApiKey = rpdbKey;
            if (includeGlobal) config.includeGlobal = true;

            const encodedConfig = encodeURIComponent(JSON.stringify(config));
            const origin = window.location.origin;

            currentManifestUrl = origin + '/' + encodedConfig + '/manifest.json';
            currentStremioUrl = currentManifestUrl.replace(/^https?:\\/\\//, 'stremio://');

            document.getElementById('manifestDisplayUrl').textContent = currentManifestUrl;
            document.getElementById('resultArea').style.display = 'block';
            document.getElementById('copyToast').classList.remove('show');

            btn.disabled = false;
            btn.textContent = 'Generate Install Link';

            document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);
    }

    function shake(el) {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = 'shake 0.4s ease';
        el.style.borderColor = '#e50914';
        el.style.boxShadow = '0 0 0 3px rgba(229,9,20,0.25)';
        setTimeout(() => {
            el.style.borderColor = '';
            el.style.boxShadow = '';
            el.style.animation = '';
        }, 800);
    }

    function copyLink() {
        navigator.clipboard.writeText(currentManifestUrl).then(() => {
            const btn = document.getElementById('copyBtn');
            btn.textContent = '✓ Copied';
            btn.classList.add('copied');
            document.getElementById('copyToast').classList.add('show');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2500);
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = currentManifestUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    function installDirectly() { if (currentStremioUrl) window.location.href = currentStremioUrl; }
    function openManifest() { if (currentManifestUrl) window.open(currentManifestUrl, '_blank'); }
</script>
</body>
</html>`;
}

// ============================================================
// VERCEL / NODE.JS SERVER EXPORT
// ============================================================
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const { url } = req;
    
    // Normalize path to ignore /api/index.js if prepended by Vercel local dev
    let path = url;
    if (path.startsWith('/api/index.js')) {
        path = path.replace('/api/index.js', '');
    }
    if (path === "") path = "/";

    if (path === "/" || path === "/configure") {
        const countries = await getAvailableCountries();
        const latestWeek = await getLatestWeekDate();
        const html = await buildConfigHTML(countries, latestWeek);
        res.setHeader("Content-Type", "text/html;charset=UTF-8");
        return res.status(200).send(html);
    }

    if (path === "/health") {
        const tsvTs = getTsvTimestamp();
        return res.status(200).json({
            status: "ok",
            tsvCacheAge: tsvTs > 0 ? Date.now() - tsvTs : null,
            lastTsvFetch: tsvTs > 0 ? new Date(tsvTs).toISOString() : null,
            cachedCatalogs: getCacheSize(),
            time: new Date().toISOString(),
        });
    }

    if (path === "/validate-tmdb-key" && req.method === "POST") {
        // Read body and parse
        let body = {};
        if (req.body) {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
            // Manual parse
            try {
                const buffers = [];
                for await (const chunk of req) buffers.push(chunk);
                body = JSON.parse(Buffer.concat(buffers).toString());
            } catch {
                return res.status(400).json({ valid: false, message: "Invalid request body." });
            }
        }
        
        try {
            const result = await validateTmdbKey(body.apiKey || "");
            return res.status(200).json(result);
        } catch {
            return res.status(400).json({ valid: false, message: "Invalid request parameters." });
        }
    }

    if (path.endsWith("/manifest.json")) {
        const configStr = path.replace("/manifest.json", "").replace(/^\//, "");
        let country = "Romania";
        let multiCountries = [];
        let includeGlobal = false;
        try {
            const config = JSON.parse(decodeURIComponent(configStr));
            if (config.country) {
                const parts = config.country.split(",").map((c) => c.trim()).filter((c) => c);
                country = parts[0] || "Romania";
                multiCountries = parts;
            }
            if (config.includeGlobal === true) {
                includeGlobal = true;
            }
        } catch { /* use default */ }
        const manifest = buildManifest(country, multiCountries, includeGlobal);
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json(manifest);
    }

    const catalogRegex = /^\/(.*?)\/catalog\/(movie|series)\/([^/.]+)(?:\.json)?$/;
    const match = path.match(catalogRegex);

    if (match) {
        const configStr = match[1];
        const type = match[2];
        const catalogId = match[3];

        if (!configStr) {
            return res.status(400).json({ error: "Missing configuration." });
        }

        const config = parseConfig(configStr);
        if (!config) {
            return res.status(400).json({ error: "Invalid configuration. tmdbApiKey is required and must be a non-empty string." });
        }

        const metaPreviews = await buildCatalog(
            type,
            catalogId,
            config.tmdbApiKey,
            config.rpdbApiKey,
            config.country,
            config.multiCountries
        );

        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({ metas: metaPreviews });
    }

    return res.status(404).send("Not Found");
};
