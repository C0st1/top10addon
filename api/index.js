// ============================================================
// Netflix Top 10 — Stremio Addon (Vercel / Node.js) — v3.2
// Features: Drag-and-drop sortable multiselect, unmerged catalogs
// ============================================================

// --- GENERIC CACHE WITH TTL + STALE-WHILE-REVALIDATE ---
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

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
let parsedTsvCache = { parsed: null, tsvTimestamp: 0 };
let rawTsvCache = { data: "", timestamp: 0 };
const TSV_CACHE_TTL = 12 * 60 * 60 * 1000;

function getTsvTimestamp() {
    return rawTsvCache.timestamp;
}

async function fetchRawTSV() {
    if (rawTsvCache.data && Date.now() - rawTsvCache.timestamp < TSV_CACHE_TTL) {
        return rawTsvCache.data;
    }
    try {
        const url = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv";
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!response.ok) return rawTsvCache.data || "";
        const data = await response.text();
        rawTsvCache = { data, timestamp: Date.now() };
        parsedTsvCache = { parsed: null, tsvTimestamp: 0 };
        return data;
    } catch {
        return rawTsvCache.data || "";
    }
}

function parseTSV(raw) {
    const lines = raw.split("\n");
    if (lines.length < 2) return { countries: [], data: {}, globalLatestWeek: "" };

    const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());
    const ci = Math.max(0, headers.indexOf("country_name"));
    const wi = Math.max(2, headers.indexOf("week"));
    const cati = Math.max(3, headers.indexOf("category"));
    const ri = Math.max(4, headers.indexOf("weekly_rank"));
    const ti = Math.max(5, headers.indexOf("show_title"));

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
            const weeks = Object.keys(data[country][category]).filter((k) => k !== "latestWeek").sort();
            if (weeks.length > 0) data[country][category].latestWeek = weeks[weeks.length - 1];
        }
    }

    return { countries: [...countriesSet].sort(), data, globalLatestWeek };
}

async function getParsedTSV() {
    const raw = await fetchRawTSV();
    if (!raw) return parsedTsvCache.parsed || { countries: [], data: {}, globalLatestWeek: "" };
    if (!parsedTsvCache.parsed || parsedTsvCache.tsvTimestamp !== rawTsvCache.timestamp) {
        parsedTsvCache = { parsed: parseTSV(raw), tsvTimestamp: rawTsvCache.timestamp };
    }
    return parsedTsvCache.parsed;
}

let cachedCountries = { list: [], tsvTimestamp: 0 };
const FALLBACK_COUNTRIES = ["Argentina", "Australia", "Brazil", "Canada", "France", "Germany", "India", "Italy", "Japan", "Mexico", "Romania", "South Korea", "Spain", "United Kingdom", "United States"];

async function getAvailableCountries() {
    const parsed = await getParsedTSV();
    if (cachedCountries.list.length > 0 && cachedCountries.tsvTimestamp === rawTsvCache.timestamp) return cachedCountries.list;
    const list = parsed.countries.length > 0 ? parsed.countries : FALLBACK_COUNTRIES;
    cachedCountries = { list, tsvTimestamp: rawTsvCache.timestamp };
    return list;
}

const TITLE_OVERRIDES = { "The Race": "tt35052447" };

function getRpdbPosterUrl(imdbId, rpdbApiKey) {
    if (!rpdbApiKey || !imdbId || !imdbId.startsWith("tt")) return null;
    return `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
}

async function throttledMap(items, fn, concurrency = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batchResults = await Promise.allSettled(items.slice(i, i + concurrency).map(fn));
        results.push(...batchResults);
    }
    return results;
}

async function fetchNetflixTitles(categoryType, country = "Global") {
    try {
        const parsed = await getParsedTSV();
        if (!parsed.data[country] || !parsed.data[country][categoryType]) return [];
        const catData = parsed.data[country][categoryType];
        if (!catData.latestWeek || !catData[catData.latestWeek]) return [];
        
        const entries = catData[catData.latestWeek].titles.slice().sort((a, b) => a.rank - b.rank);
        const seen = new Set();
        const result = [];
        for (const e of entries) {
            if (!seen.has(e.title) && result.length < 10) {
                seen.add(e.title);
                result.push(e.title);
            }
        }
        return result;
    } catch { return []; }
}

async function getTrendForTitle(title, categoryType, country) {
    try {
        const parsed = await getParsedTSV();
        const catData = parsed.data[country]?.[categoryType];
        if (!catData) return null;
        const weeks = Object.keys(catData).filter((k) => k !== "latestWeek").sort();
        if (weeks.length < 1) return null;
        
        const latestEntry = catData[weeks[weeks.length - 1]]?.titles.find((t) => t.title === title);
        if (!latestEntry) return null;
        const prevEntry = weeks.length >= 2 ? catData[weeks[weeks.length - 2]]?.titles.find(t => t.title === title) : null;
        
        if (!prevEntry) return { indicator: "🆕", detail: "New this week" };
        const diff = prevEntry.rank - latestEntry.rank;
        if (diff > 0) return { indicator: "🔺", detail: `Up ${diff} spot${diff > 1 ? "s" : ""}` };
        if (diff < 0) return { indicator: "🔻", detail: `Down ${Math.abs(diff)} spot${Math.abs(diff) > 1 ? "s" : ""}` };
        return { indicator: "➖", detail: "No change" };
    } catch { return null; }
}

async function fetchGlobalTitles(categoryType) {
    try {
        const parsed = await getParsedTSV();
        const titleCounts = new Map();
        for (const country of Object.keys(parsed.data)) {
            const catData = parsed.data[country][categoryType];
            if (!catData || !catData.latestWeek || !catData[catData.latestWeek]) continue;
            const seen = new Set();
            for (const entry of catData[catData.latestWeek].titles) {
                if (seen.has(entry.title)) continue;
                seen.add(entry.title);
                const ex = titleCounts.get(entry.title) || { count: 0, rankSum: 0 };
                ex.count++; ex.rankSum += entry.rank;
                titleCounts.set(entry.title, ex);
            }
        }
        return [...titleCounts.entries()]
            .sort((a, b) => b[1].count - a[1].count || a[1].rankSum / a[1].count - b[1].rankSum / b[1].count)
            .slice(0, 10).map(([t]) => t);
    } catch { return []; }
}
async function matchTMDB(title, type, apiKey, rpdbApiKey, categoryType, country) {
    if (!apiKey) return null;
    try {
        const cleanTitle = title.replace(/: Season \d+/gi, "").replace(/ - Season \d+/gi, "").trim();
        
        if (TITLE_OVERRIDES[cleanTitle]) {
            const res = await fetch(`https://api.themoviedb.org/3/find/${TITLE_OVERRIDES[cleanTitle]}?api_key=${apiKey}&external_source=imdb_id`);
            if (res.ok) {
                const data = await res.json();
                const matched = type === "tv" ? data.tv_results?.[0] : data.movie_results?.[0];
                if (matched) {
                    const meta = formatMeta(matched, TITLE_OVERRIDES[cleanTitle], type, rpdbApiKey);
                    if (categoryType && country) {
                        const trend = await getTrendForTitle(title, categoryType, country);
                        if (trend) appendTrend(meta, trend);
                    }
                    return meta;
                }
            }
        }

        const sRes = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}&language=en-US&page=1`);
        if (!sRes.ok) return null;
        const sData = await sRes.json();
        
        if (sData.results?.length > 0) {
            const candidates = sData.results.slice(0, 5);
            const exact = candidates.filter(i => {
                const itemT = (type === "tv" ? i.name : i.title)?.toLowerCase();
                const origT = (type === "tv" ? i.original_name : i.original_title)?.toLowerCase();
                const ct = cleanTitle.toLowerCase();
                return itemT === ct || origT === ct;
            });
            const best = exact.length > 0 ? exact.sort((a,b) => new Date(b.release_date||b.first_air_date||"1900-01-01") - new Date(a.release_date||a.first_air_date||"1900-01-01"))[0] : candidates[0];
            
            let finalId = `tmdb:${best.id}`;
            const cKey = getImdbCacheKey(type, best.id);
            if (imdbCache.has(cKey)) finalId = imdbCache.get(cKey);
            else {
                try {
                    const extRes = await fetch(`https://api.themoviedb.org/3/${type}/${best.id}?api_key=${apiKey}&append_to_response=external_ids`);
                    if (extRes.ok) {
                        const extData = await extRes.json();
                        const imdbId = extData.external_ids?.imdb_id || extData.imdb_id;
                        if (imdbId) { finalId = imdbId; imdbCache.set(cKey, imdbId); }
                    }
                } catch {}
            }
            
            const meta = formatMeta(best, finalId, type, rpdbApiKey);
            if (categoryType && country) {
                const trend = await getTrendForTitle(title, categoryType, country);
                if (trend) appendTrend(meta, trend);
            }
            return meta;
        }
    } catch {}
    return null;
}

function appendTrend(meta, trend) { meta.description = `${trend.indicator} ${trend.detail}\n\n${meta.description || ""}`; }

function formatMeta(item, finalId, type, rpdbApiKey) {
    const tmdbP = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
    return {
        id: finalId,
        type: type === "tv" ? "series" : "movie",
        name: item.title || item.name,
        poster: getRpdbPosterUrl(finalId, rpdbApiKey) || tmdbP,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || "",
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
    };
}

const toIdSlug = (c) => c.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function buildManifest(country = "Global", multiCountries = []) {
    const list = multiCountries.length > 0 ? multiCountries : [country];
    const catalogs = [];

    // Improvement: Unmerged catalogs preserving exact user order
    for (const c of list) {
        if (c.toLowerCase() === "global") {
            catalogs.push(
                { type: "movie", id: "netflix_top10_movies_global", name: "Netflix Top 10 Movies (Global)" },
                { type: "series", id: "netflix_top10_series_global", name: "Netflix Top 10 TV Shows (Global)" }
            );
        } else {
            const idSlug = toIdSlug(c);
            catalogs.push(
                { type: "movie", id: `netflix_top10_movies_${idSlug}`, name: `Netflix Top 10 Movies (${c})` },
                { type: "series", id: `netflix_top10_series_${idSlug}`, name: `Netflix Top 10 TV Shows (${c})` }
            );
        }
    }

    return {
        id: "org.stremio.netflixtop10", // Stay static to prevent duplicate addons when config changes
        version: "3.2.0",
        name: "Netflix Top 10",
        description: "Weekly updated Netflix Top 10 rankings per-country with precise Stremio catalogs.",
        logo: "https://img.icons8.com/color/256/netflix.png",
        types: ["movie", "series"],
        catalogs,
        resources: ["catalog"],
        behaviorHints: { configurable: true },
        config: [
            { key: "tmdbApiKey", type: "text", title: "TMDB API Key", required: true }
        ],
    };
}

async function buildCatalog(type, catalogId, apiKey, rpdbApiKey, country, multiCountries) {
    const cacheKey = `${type}_${catalogId}_${rpdbApiKey || "no_rpdb"}`;
    const cached = getCached(cacheKey);
    if (cached.data && !cached.stale) return cached.data;
    if (cached.data && cached.stale) {
        fetchCatalogFresh(cacheKey, type, catalogId, apiKey, rpdbApiKey, multiCountries).catch(() => {});
        return cached.data;
    }
    return await fetchCatalogFresh(cacheKey, type, catalogId, apiKey, rpdbApiKey, multiCountries);
}

async function fetchCatalogFresh(cacheKey, type, catalogId, apiKey, rpdbApiKey, multiCountries) {
    const isGlobal = catalogId.endsWith("_global");
    const tmdbType = type === "movie" ? "movie" : "tv";
    const categoryType = type === "movie" ? "Films" : "TV";

    let titles = [];
    let targetCountry = "";

    if (isGlobal || catalogId.endsWith("_global")) {
        titles = await fetchGlobalTitles(categoryType);
    } else {
        const prefix = catalogId.includes("movies_") ? "netflix_top10_movies_" : "netflix_top10_series_";
        const idSlug = catalogId.replace(prefix, "");
        targetCountry = multiCountries.find(c => toIdSlug(c) === idSlug) || idSlug;
        titles = await fetchNetflixTitles(categoryType, targetCountry);
    }

    if (titles.length === 0) return [];

    const metas = (await throttledMap(titles, (title) => matchTMDB(title, tmdbType, apiKey, rpdbApiKey, categoryType, targetCountry), 3))
        .filter(r => r.status === "fulfilled" && r.value)
        .map(r => r.value);
    
    if (metas.length > 0) setCache(cacheKey, metas);
    return metas;
}

async function getLatestWeekDate() { return (await getParsedTSV()).globalLatestWeek || "Unknown"; }
async function validateTmdbKey(apiKey) {
    if (!apiKey?.trim()) return { valid: false, message: "API key empty." };
    try {
        const r = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${apiKey.trim()}`);
        if (r.ok) return { valid: true, message: "Valid API key!" };
        return { valid: false, message: r.status === 401 ? "Unauthorized." : `Error ${r.status}` };
    } catch (e) { return { valid: false, message: `Network error: ${e.message}` }; }
}

function parseConfig(configStr) {
    try {
        const config = JSON.parse(decodeURIComponent(configStr));
        if (!config?.tmdbApiKey?.trim()) return null;
        const mc = (config.country || "Global").split(",").map(c => c.trim()).filter(c => c);
        return {
            tmdbApiKey: config.tmdbApiKey.trim(),
            rpdbApiKey: config.rpdbApiKey?.trim() || null,
            country: mc[0] || "Global",
            multiCountries: mc
        };
    } catch { return null; }
}
async function buildConfigHTML(countries, latestWeek) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Netflix Top 10 — Stremio Addon</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --red: #e50914; --bg: #0a0a0a; --surface: #111111; --surface2: #1a1a1a; --border: #2a2a2a; --text: #f0f0f0; --muted: #777; --success: #2ecc71; --warning: #f39c12; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
        .card { width: 100%; max-width: 480px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.6); position: relative; z-index:1; }
        .card-header { background: linear-gradient(135deg, #1a0000 0%, #1a0505 50%, #0a0a0a 100%); padding: 36px 36px 28px; border-bottom: 1px solid var(--border); }
        .card-header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; }
        .card-header p { font-size: 13px; color: var(--muted); margin-top: 6px; }
        .logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .logo-n { font-family: 'Bebas Neue', sans-serif; font-size: 38px; color: var(--red); line-height: 1; letter-spacing: -1px; }
        .logo-badge { background: var(--red); color: #fff; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; }
        .week-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 4px 10px; background: rgba(229,9,20,0.1); border: 1px solid rgba(229,9,20,0.2); border-radius: 6px; font-size: 11px; color: #e57373; }
        .card-body { padding: 28px 36px 36px; }
        .field { margin-bottom: 20px; position: relative; }
        .field label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
        .field label .required-dot { width: 5px; height: 5px; background: var(--red); border-radius: 50%; }
        .field label .optional-tag { font-size: 10px; background: var(--surface2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 3px; }
        input[type="text"], input[type="password"] { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 12px 14px; outline: none; transition: 0.2s; }
        input[type="text"]:focus, input[type="password"]:focus { border-color: var(--red); box-shadow: 0 0 0 3px rgba(229,9,20,0.15); }
        .toggle-field { display: flex; align-items: center; gap: 10px; margin: 15px 0 20px; cursor: pointer; }
        .toggle-field label { font-size: 13px; cursor: pointer; font-weight: 500;}
        input[type="checkbox"] { appearance: none; background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; }
        input[type="checkbox"]:checked { background: var(--red); border-color: var(--red); }
        input[type="checkbox"]:checked::after { content: '\\2714'; font-size: 12px; color: white; }
        .hint { font-size: 11.5px; color: var(--muted); margin-top: 6px; line-height: 1.4; }
        .hint a { color: #6699cc; text-decoration: none; }
        .multi-countries { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        
        /* Drag and Drop Pill UI */
        .country-tag { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(30,30,30,0.9); border: 1px solid #333; border-radius: 8px; font-size: 13px; color: #e0e0e0; cursor: grab; transition: border-color 0.2s, background 0.2s, transform 0.15s; }
        .country-tag:active { cursor: grabbing; transform: scale(0.98); }
        .country-tag.dragging { opacity: 0.5; background: #333; border-style: dashed; }
        .country-drag-handle { color: var(--muted); margin-right: 12px; user-select: none; font-size: 16px; cursor: grab; }
        .remove-tag { color: #888; font-size: 16px; cursor: pointer; padding: 2px 6px; transition: 0.2s; }
        .remove-tag:hover { color: var(--red); }
        
        /* Custom Dropdown */
        .custom-select { position: relative; }
        .dropdown-list { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--surface2); border: 1px solid var(--red); border-top: none; border-radius: 0 0 8px 8px; max-height: 200px; overflow-y: auto; z-index: 10; margin-top: -8px; padding-top: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .dropdown-list.open { display: block; animation: openDrop 0.2s ease forwards; }
        .drop-item { padding: 10px 14px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #222; transition: 0.15s; }
        .drop-item:hover { background: rgba(229,9,20,0.1); color: #fff; }
        .drop-item.selected { opacity: 0.5; cursor: not-allowed; }
        
        @keyframes openDrop { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

        .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: 0.18s; }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-primary { background: var(--red); color: #fff; }
        .btn-primary:hover:not(:disabled) { background: #f40612; box-shadow: 0 6px 20px rgba(229,9,20,0.35); }
        .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); margin-top: 10px; }
        .btn-sm { display: inline-block; width: auto; padding: 8px 14px; font-size: 12px; margin-top: 6px; }
        .key-status { display: inline-flex; font-size: 12px; margin-left: 8px; }
        .key-status.valid { color: var(--success); } .key-status.invalid { color: var(--red); }
        #resultArea { display: none; margin-top: 24px; animation: popIn 0.3s ease; }
        .url-box { display: flex; align-items: center; gap: 8px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
        .url-box-text { flex: 1; font-family: monospace; font-size: 11px; color: #5dade2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .copy-btn { font-size: 11px; background: transparent; border: 1px solid #555; color: #fff; padding: 4px 10px; border-radius: 4px; cursor: pointer; transition: 0.2s;}
        .copy-btn.copied { background: rgba(46, 204, 113, 0.2); border-color: var(--success); color: var(--success); transform: scale(1.05); }
        .toast { display: none; align-items: center; gap: 8px; background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.3); border-radius: 6px; padding: 10px 14px; font-size: 13px; color: var(--success); margin-bottom: 15px; }
        .toast.show { display: flex; animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes popIn { 0% { opacity: 0; transform: translateY(-10px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        .input-with-icon { position: relative; display: flex; align-items: center; }
        .input-with-icon input { padding-right: 40px; }
        .toggle-pwd { position: absolute; right: 10px; background: transparent; border: none; font-size: 16px; cursor: pointer; opacity: 0.6; padding: 0; transition: 0.2s; }
        .toggle-pwd:hover { opacity: 1; transform: scale(1.1); }
    </style>
</head>
<body>
<div class="card">
    <div class="card-header">
        <div class="logo-row"><span class="logo-n">N</span><span class="logo-badge">Stremio Addon</span></div>
        <h1>Netflix Top 10</h1>
        <p>Dynamic unmerged catalogs per country with correct Stremio metadata matching.</p>
        <div class="week-badge"><span>Week of <strong>${latestWeek}</strong></span></div>
    </div>
    <div class="card-body">
        <div class="field">
            <label><span class="required-dot"></span> Country <span class="optional-tag">Reorderable Catalogs</span></label>
            <div class="custom-select">
                <input type="text" id="countrySearch" placeholder="Search a country to add..." autocomplete="off">
                <div class="dropdown-list" id="countryDropdown"></div>
            </div>
            <div class="multi-countries" id="selectedCountries"></div>
            <p class="hint">Click or search to select. <b>Drag to re-order</b> which catalogs appear first in Stremio.</p>
        </div>
        <div class="field">
            <label><span class="required-dot"></span> TMDB API Key</label>
            <div class="input-with-icon">
                <input type="password" id="tmdbKey" placeholder="e.g. 8a7f3bc2d1...">
                <button class="toggle-pwd" onclick="togglePwd('tmdbKey', this)" title="Show/Hide">👁️</button>
            </div>
            <p class="hint" style="margin-bottom:8px;">Required for Stremio metadata. Get yours free at <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org</a>.</p>
            <button class="btn btn-sm" id="testKeyBtn" onclick="testTmdbKey()">Test Key</button> <span id="keyStatus" class="key-status"></span>
        </div>
        <div class="field">
            <label>RPDB API Key <span class="optional-tag">optional</span></label>
            <div class="input-with-icon">
                <input type="password" id="rpdbKey" placeholder="e.g. t1-xxxxxx...">
                <button class="toggle-pwd" onclick="togglePwd('rpdbKey', this)" title="Show/Hide">👁️</button>
            </div>
            <p class="hint">Adds Netflix-style rating overlays to posters. Get a key at <a href="https://ratingposterdb.com/" target="_blank">ratingposterdb.com</a>.</p>
        </div>

        <button class="btn btn-primary" id="generateBtn" onclick="generateLink()">Generate Install Link</button>
        <div id="resultArea">
            <p style="font-size:12px;color:#999;">Manifest URL:</p>
            <div class="url-box"><span class="url-box-text" id="manifestDisplayUrl"></span><button class="copy-btn" onclick="copyLink()">Copy</button></div>
            <div class="toast" id="copyToast">✅ Copied to clipboard!</div>
            <button class="btn btn-secondary" onclick="installDirectly()">▶ Install to Stremio</button>
        </div>
    </div>
</div>
<script>
    const availableCountries = ["Global", ...${JSON.stringify(countries)}];
    let selectedCountriesList = [];
    const searchInput = document.getElementById('countrySearch');
    const dropdown = document.getElementById('countryDropdown');
    const selectedContainer = document.getElementById('selectedCountries');

    function renderDropdown(filter="") {
        dropdown.innerHTML = '';
        const lowerFilter = filter.toLowerCase();
        let matches = 0;
        availableCountries.forEach(c => {
            if (c.toLowerCase().includes(lowerFilter)) {
                matches++;
                const isSelected = selectedCountriesList.includes(c);
                const item = document.createElement('div');
                item.className = 'drop-item' + (isSelected ? ' selected' : '');
                item.textContent = c;
                item.onclick = (e) => {
                    e.stopPropagation();
                    if (!isSelected) { 
                        addCountry(c); 
                        searchInput.value = ''; 
                        renderDropdown(''); 
                        searchInput.focus(); 
                    }
                };
                dropdown.appendChild(item);
            }
        });
        if (matches === 0) dropdown.innerHTML = '<div class="drop-item" style="pointer-events:none;color:#555;">No countries found</div>';
    }

    searchInput.addEventListener('focus', () => { dropdown.classList.add('open'); renderDropdown(searchInput.value); });
    searchInput.addEventListener('input', e => renderDropdown(e.target.value));
    document.addEventListener('click', e => { if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('open'); });

    function addCountry(c) {
        if (!selectedCountriesList.includes(c)) { selectedCountriesList.push(c); renderTags(); saveState(); }
    }
    
    function removeCountry(c) {
        selectedCountriesList = selectedCountriesList.filter(x => x !== c);
        renderTags(); saveState(); renderDropdown(searchInput.value);
    }

    // Drag and Drop ordering logic
    let dragSrcEl = null;

    function handleDragStart(e) {
        dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML);
        e.dataTransfer.setData('country', this.dataset.country);
        setTimeout(() => this.classList.add('dragging'), 0);
    }

    function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
    function handleDragEnter(e) { this.style.borderColor = '#e50914'; }
    function handleDragLeave(e) { this.style.borderColor = '#333'; }
    
    function handleDrop(e) {
        e.stopPropagation();
        this.style.borderColor = '#333';
        if (dragSrcEl !== this) {
            const dragCountry = dragSrcEl.dataset.country;
            const dropCountry = this.dataset.country;
            const fromIdx = selectedCountriesList.indexOf(dragCountry);
            const toIdx = selectedCountriesList.indexOf(dropCountry);
            
            selectedCountriesList.splice(fromIdx, 1);
            selectedCountriesList.splice(toIdx, 0, dragCountry);
            renderTags(); saveState();
        }
        return false;
    }

    function handleDragEnd() { this.classList.remove('dragging'); Array.from(document.querySelectorAll('.country-tag')).forEach(t => t.style.borderColor = '#333'); }

    function renderTags() {
        selectedContainer.innerHTML = '';
        selectedCountriesList.forEach(c => {
            const pill = document.createElement('div');
            pill.className = 'country-tag'; pill.draggable = true; pill.dataset.country = c;
            pill.innerHTML = \`<div style="display:flex;align-items:center;"><span class="country-drag-handle">☰</span> <span>\${c}</span></div> <span class="remove-tag" onclick="removeCountry('\${c}')">&times;</span>\`;
            
            pill.addEventListener('dragstart', handleDragStart);
            pill.addEventListener('dragenter', handleDragEnter);
            pill.addEventListener('dragover', handleDragOver);
            pill.addEventListener('dragleave', handleDragLeave);
            pill.addEventListener('drop', handleDrop);
            pill.addEventListener('dragend', handleDragEnd);
            
            selectedContainer.appendChild(pill);
        });
    }

    function saveState() {
        try { localStorage.setItem('nf_top10_config', JSON.stringify({ tmdbKey: document.getElementById('tmdbKey').value, rpdbKey: document.getElementById('rpdbKey').value, countries: selectedCountriesList })); } catch {}
    }

    (function restoreState() {
        try {
            const s = JSON.parse(localStorage.getItem('nf_top10_config') || '{}');
            if (s.tmdbKey) document.getElementById('tmdbKey').value = s.tmdbKey;
            if (s.rpdbKey) document.getElementById('rpdbKey').value = s.rpdbKey;
            if (s.countries?.length) s.countries.forEach(addCountry); else addCountry('Global');
        } catch { addCountry('Global'); }
    })();

    async function testTmdbKey() { /* Redacted visual updates for brevity, keeps core API call */
        const key = document.getElementById('tmdbKey').value.trim();
        const stat = document.getElementById('keyStatus');
        if (!key) return; stat.textContent = 'Testing...';
        try { const r = await fetch('/api/index.js/validate-tmdb-key', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
              const d = await r.json(); stat.textContent = d.valid ? '✅ Valid' : '❌ Invalid'; } 
        catch { stat.textContent = '❌ Error'; }
    }

    let currentManifestUrl = "";
    function generateLink() {
        saveState();
        const tmdbKey = document.getElementById('tmdbKey').value.trim();
        const rpdbKey = document.getElementById('rpdbKey').value.trim();
        if (!tmdbKey) return;
        
        let cfg = { tmdbApiKey: tmdbKey, country: selectedCountriesList.join(',') };
        if (rpdbKey) cfg.rpdbApiKey = rpdbKey;
        
        currentManifestUrl = window.location.origin + '/' + encodeURIComponent(JSON.stringify(cfg)) + '/manifest.json';
        document.getElementById('manifestDisplayUrl').textContent = currentManifestUrl;
        document.getElementById('resultArea').style.display = 'block';
    }
    
    function togglePwd(id, btn) {
        const input = document.getElementById(id);
        if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
        else { input.type = 'password'; btn.textContent = '👁️'; }
    }

    function copyLink() {
        navigator.clipboard.writeText(currentManifestUrl);
        const btn = document.querySelector('.copy-btn');
        const toast = document.getElementById('copyToast');
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        toast.classList.add('show');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); toast.classList.remove('show'); }, 2500);
    }
    function installDirectly() { window.location.href = currentManifestUrl.replace(/^https?:\\/\\//, 'stremio://'); }
</script>
</body>
</html>`;
}

// ===================================
// VERCEL / NODE.JS SERVER EXPORT
// ===================================
module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    let path = req.url;
    if (path.startsWith('/api/index.js')) path = path.replace('/api/index.js', '');
    if (path === "") path = "/";

    if (path === "/" || path === "/configure") {
        return res.status(200).setHeader("Content-Type", "text/html;charset=UTF-8").send(await buildConfigHTML(await getAvailableCountries(), await getLatestWeekDate()));
    }

    if (path === "/health") {
        const tsvTs = getTsvTimestamp();
        return res.status(200).json({ status: "ok", lastTsvFetch: tsvTs > 0 ? new Date(tsvTs).toISOString() : null, time: new Date().toISOString() });
    }

    if (path === "/validate-tmdb-key" && req.method === "POST") {
        let body = {};
        if (req.body) body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        else try { const bufs = []; for await (const c of req) bufs.push(c); body = JSON.parse(Buffer.concat(bufs).toString()); } catch {}
        return res.status(200).json(await validateTmdbKey(body.apiKey || ""));
    }

    if (path.endsWith("/manifest.json")) {
        const configStr = path.replace("/manifest.json", "").replace(/^\//, "");
        let cc = "Global", mcs = [];
        try { const cfg = JSON.parse(decodeURIComponent(configStr)); if (cfg.country) { mcs = cfg.country.split(",").map(c=>c.trim()).filter(c=>c); cc = mcs[0]; } } catch {}
        return res.status(200).setHeader("Content-Type", "application/json").json(buildManifest(cc, mcs));
    }

    const match = path.match(/^\/(.*?)\/catalog\/(movie|series)\/([^/.]+)(?:\.json)?$/);
    if (match) {
        const config = parseConfig(match[1]);
        if (!config) return res.status(400).json({ error: "Missing/Invalid config" });
        const metas = await buildCatalog(match[2], match[3], config.tmdbApiKey, config.rpdbApiKey, config.country, config.multiCountries);
        return res.status(200).setHeader("Content-Type", "application/json").json({ metas });
    }

    return res.status(404).send("Not Found");
};
