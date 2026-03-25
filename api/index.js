// ============================================================
// Netflix Top 10 — Stremio Addon (Vercel / Node.js) — v3.2
// Features: Drag-and-drop sortable multiselect, unmerged catalogs
// ============================================================

const cheerio = require('cheerio'); // Added for FlixPatrol scraping

// --- GENERIC CACHE WITH TTL + STALE-WHILE-REVALIDATE ---
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return { data: null, stale: false };
    const isStale = Date.now() - entry.timestamp > CACHE_TTL;
    return { data: entry.data, stale: isStale };
}

function enforceCacheLimit(map, limit = 500) {
    if (map.size > limit) map.delete(map.keys().next().value);
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
    enforceCacheLimit(cache, 1000);
}

function getCacheSize() {
    return cache.size;
}

// --- IMDB ID CACHE ---
const imdbCache = new Map();

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

function getImdbCacheKey(type, tmdbId) {
    return `${type}_${tmdbId}`;
}

// --- TSV STRUCTURED CACHE ---
let parsedTsvCache = { parsed: null, tsvTimestamp: 0 };
let rawTsvCache = { data: "", timestamp: 0 };
const TSV_CACHE_TTL = 12 * 60 * 60 * 1000;
let rawTsvFetchPromise = null;

function getTsvTimestamp() {
    return rawTsvCache.timestamp;
}

async function fetchRawTSV() {
    if (rawTsvCache.data && Date.now() - rawTsvCache.timestamp < TSV_CACHE_TTL) {
        return rawTsvCache.data;
    }
    if (rawTsvFetchPromise) return rawTsvFetchPromise;
    rawTsvFetchPromise = (async () => {
        try {
            const url = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv";
            const headers = { "User-Agent": "Mozilla/5.0" };
            if (rawTsvCache.timestamp) headers["If-Modified-Since"] = new Date(rawTsvCache.timestamp).toUTCString();
            const response = await fetchWithTimeout(url, { headers }, 12000);
            if (response.status === 304) {
                rawTsvCache.timestamp = Date.now();
                return rawTsvCache.data;
            }
            if (!response.ok) return rawTsvCache.data || "";
            const data = await response.text();
            rawTsvCache = { data, timestamp: Date.now() };
            parsedTsvCache = { parsed: null, tsvTimestamp: 0 };
            return data;
        } catch {
            return rawTsvCache.data || "";
        } finally {
            rawTsvFetchPromise = null;
        }
    })();
    return rawTsvFetchPromise;
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
        
        const catData = data[country][category];
        if (!catData.latestWeek || week > catData.latestWeek) {
            catData.latestWeek = week;
            catData[week] = { titles: [] };
            for (const oldWeek in catData) {
                if (oldWeek !== 'latestWeek' && oldWeek !== week) delete catData[oldWeek];
            }
        }
        if (week === catData.latestWeek) {
            catData[week].titles.push({ title, rank });
        }
        
        if (week > globalLatestWeek) globalLatestWeek = week;
    }

    const globalTitles = { "Films": new Map(), "TV": new Map() };
    for (const c in data) {
        for (const cat in data[c]) {
            const lw = data[c][cat].latestWeek;
            if (!lw || !data[c][cat][lw]) continue;
            data[c][cat][lw].titles.sort((a,b) => a.rank - b.rank);
            
            const gMap = globalTitles[cat];
            if (gMap) {
                for (const t of data[c][cat][lw].titles) {
                    const ex = gMap.get(t.title) || { count: 0, rankSum: 0 };
                    ex.count++; ex.rankSum += t.rank;
                    gMap.set(t.title, ex);
                }
            }
        }
    }
    
    const precomputedGlobals = {
        "Films": [...globalTitles["Films"].entries()].sort((a, b) => b[1].count - a[1].count || a[1].rankSum / a[1].count - b[1].rankSum / b[1].count).slice(0, 10).map(([t]) => t),
        "TV": [...globalTitles["TV"].entries()].sort((a, b) => b[1].count - a[1].count || a[1].rankSum / a[1].count - b[1].rankSum / b[1].count).slice(0, 10).map(([t]) => t)
    };

    return { countries: [...countriesSet].sort(), data, globalLatestWeek, globalTitles: precomputedGlobals };
}

async function getParsedTSV() {
    const raw = await fetchRawTSV();
    if (!raw) return parsedTsvCache.parsed || { countries: [], data: {}, globalLatestWeek: "", globalTitles: {} };
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
    
    // Ensure Romania is always present since we scrape it independently now
    if (!list.includes("Romania")) {
        list.push("Romania");
        list.sort();
    }

    cachedCountries = { list, tsvTimestamp: rawTsvCache.timestamp };
    return list;
}

const TITLE_OVERRIDES = { "the race": "tt35052447" };
const tmdbMatchCache = new Map();
const TMDB_MATCH_CACHE_TTL = 6 * 60 * 60 * 1000;
const tmdbMatchInFlight = new Map();

function getTmdbMatchCacheKey(title, type) {
    return `${type}|${title.toLowerCase()}`;
}

function getCachedTmdbMatch(cacheKey) {
    const hit = tmdbMatchCache.get(cacheKey);
    if (!hit) return undefined;
    if (Date.now() - hit.timestamp > TMDB_MATCH_CACHE_TTL) {
        tmdbMatchCache.delete(cacheKey);
        return undefined;
    }
    return hit.value;
}

function getRpdbPosterUrl(imdbId, rpdbApiKey) {
    if (!rpdbApiKey || !imdbId || !imdbId.startsWith("tt")) return null;
    return `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
}

async function pMap(items, fn, concurrency = 5) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);
        if (executing.size >= concurrency) await Promise.race(executing);
    }
    return Promise.all(results);
}

// --- FLIXPATROL SCRAPER FOR ROMANIA ---
async function fetchFlixPatrolTitles(categoryType) {
    const cacheKey = `flixpatrol_romania_${categoryType}`;
    const cached = getCached(cacheKey);
    if (cached.data && !cached.stale) return cached.data;
    
    try {
        const url = "https://flixpatrol.com/top10/netflix/romania/";
        const opts = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } };
        const res = await fetchWithTimeout(url, opts, 12000);
        if (!res.ok) throw new Error(`FlixPatrol fetch failed with status ${res.status}`);
        
        const html = await res.text();
        const $ = cheerio.load(html);
        const titles = [];
        const targetHeader = categoryType === "Films" ? "TOP 10 Movies" : "TOP 10 TV Shows";
        
        // Find elements containing the target header text
        const headers = $(`*:contains("${targetHeader}")`).filter(function() {
            return $(this).children().length === 0;
        });

        if (headers.length > 0) {
            // Traverse up to find the closest wrapper/table for this specific section
            let container = headers.first().closest('table');
            if (container.length === 0) container = headers.first().closest('div').nextAll('table').first();
            if (container.length === 0) container = headers.first().closest('.card, .table-wrapper, div[class*="flex"], div[class*="grid"]');

            container.find('a[href*="/title/"]').each((i, a) => {
                const title = $(a).text().trim();
                if (title && !titles.includes(title) && titles.length < 10) {
                    titles.push(title);
                }
            });
        }

        // Fallback: If layout changes, just grab all title links sequentially
        if (titles.length === 0) {
            const allTitles = [];
            $('a[href*="/title/"]').each((i, a) => {
                const title = $(a).text().trim();
                if (title && !allTitles.includes(title)) {
                    allTitles.push(title);
                }
            });
            // Movies usually appear first, TV Shows second in the layout
            if (categoryType === "Films") {
                titles.push(...allTitles.slice(0, 10));
            } else {
                titles.push(...allTitles.slice(10, 20));
            }
        }
        
        if (titles.length > 0) {
            setCache(cacheKey, titles);
        }
        return titles;
    } catch (err) {
        console.error("FlixPatrol scrape error:", err);
        return []; // Return empty array to prevent breaking the flow
    }
}

async function fetchNetflixTitles(categoryType, country = "Global") {
    try {
        const parsed = await getParsedTSV();
        if (!parsed.data[country] || !parsed.data[country][categoryType]) return [];
        const catData = parsed.data[country][categoryType];
        if (!catData.latestWeek || !catData[catData.latestWeek]) return [];
        
        const entries = catData[catData.latestWeek].titles;
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

async function fetchGlobalTitles(categoryType) {
    try {
        const parsed = await getParsedTSV();
        return parsed.globalTitles[categoryType] || [];
    } catch { return []; }
}

async function matchTMDB(title, type, apiKey) {
    if (!apiKey) return null;
    const cacheKey = getTmdbMatchCacheKey(title, type);
    const cached = getCachedTmdbMatch(cacheKey);
    if (cached !== undefined) return cached;
    if (tmdbMatchInFlight.has(cacheKey)) return tmdbMatchInFlight.get(cacheKey);

    const run = (async () => {
    try {
        const cleanTitle = title.replace(/[:\-]?\s*Season\s+\d+/gi, "").trim();
        const cleanTitleLower = cleanTitle.toLowerCase();
        
        if (TITLE_OVERRIDES[cleanTitleLower]) {
            const res = await fetchWithTimeout(`https://api.themoviedb.org/3/find/${TITLE_OVERRIDES[cleanTitleLower]}?api_key=${apiKey}&external_source=imdb_id`);
            if (res.ok) {
                const data = await res.json();
                const matched = type === "tv" ? data.tv_results?.[0] : data.movie_results?.[0];
                if (matched) {
                    const meta = formatMeta(matched, TITLE_OVERRIDES[cleanTitleLower], type);
                    tmdbMatchCache.set(cacheKey, { value: meta, timestamp: Date.now() });
                    enforceCacheLimit(tmdbMatchCache, 2000);
                    return meta;
                }
            }
        }

        const sRes = await fetchWithTimeout(`https://api.themoviedb.org/3/search/${type}?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}&language=en-US&page=1`);
        if (!sRes.ok) throw new Error("TMDB Search Failed");
        const sData = await sRes.json();
        
        if (sData.results?.length > 0) {
            const candidates = sData.results.slice(0, 5);
            const exact = candidates.filter(i => {
                const itemT = (type === "tv" ? i.name : i.title)?.toLowerCase();
                const origT = (type === "tv" ? i.original_name : i.original_title)?.toLowerCase();
                return itemT === cleanTitleLower || origT === cleanTitleLower;
            });
            const best = exact.length > 0 ? exact.sort((a,b) => new Date(b.release_date||b.first_air_date||"1900-01-01") - new Date(a.release_date||a.first_air_date||"1900-01-01"))[0] : candidates[0];
            
            let finalId = `tmdb:${best.id}`;
            const cKey = getImdbCacheKey(type, best.id);
            if (imdbCache.has(cKey)) finalId = imdbCache.get(cKey);
            else {
                try {
                    const extRes = await fetchWithTimeout(`https://api.themoviedb.org/3/${type}/${best.id}?api_key=${apiKey}&append_to_response=external_ids`);
                    if (extRes.ok) {
                        const extData = await extRes.json();
                        const imdbId = extData.external_ids?.imdb_id || extData.imdb_id;
                        if (imdbId) { finalId = imdbId; imdbCache.set(cKey, imdbId); enforceCacheLimit(imdbCache, 5000); }
                    }
                } catch {}
            }
            
            const meta = formatMeta(best, finalId, type);
            tmdbMatchCache.set(cacheKey, { value: meta, timestamp: Date.now() });
            enforceCacheLimit(tmdbMatchCache, 2000);
            return meta;
        }
        
        tmdbMatchCache.set(cacheKey, { value: null, timestamp: Date.now() });
        enforceCacheLimit(tmdbMatchCache, 2000);
        return null;
    } catch {
        return null;
    }
    })();

    tmdbMatchInFlight.set(cacheKey, run);
    try {
        return await run;
    } finally {
        tmdbMatchInFlight.delete(cacheKey);
    }
}

function formatMeta(item, finalId, type) {
    const tmdbP = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
    return {
        id: finalId,
        type: type === "tv" ? "series" : "movie",
        name: item.title || item.name,
        tmdbPoster: tmdbP,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || "",
        releaseInfo: (item.release_date || item.first_air_date || "").substring(0, 4),
    };
}

const toIdSlug = (c) => c.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function buildManifest(country = "Global", multiCountries = [], movieType = "movie", seriesType = "series") {
    const list = multiCountries.length > 0 ? multiCountries : [country];
    const catalogs = [];

    // Improvement: Unmerged catalogs preserving exact user order
    for (const c of list) {
        if (c.toLowerCase() === "global") {
            catalogs.push(
                { type: movieType, id: "netflix_top10_movies_global", name: "Netflix Top 10 (Global)" },
                { type: seriesType, id: "netflix_top10_series_global", name: "Netflix Top 10 (Global)" }
            );
        } else {
            const idSlug = toIdSlug(c);
            catalogs.push(
                { type: movieType, id: `netflix_top10_movies_${idSlug}`, name: `Netflix Top 10 (${c})` },
                { type: seriesType, id: `netflix_top10_series_${idSlug}`, name: `Netflix Top 10 (${c})` }
            );
        }
    }

    return {
        id: "org.stremio.netflixtop10", // Stay static to prevent duplicate addons when config changes
        version: "3.2.0",
        name: "Netflix Top 10",
        description: "Weekly updated Netflix Top 10 rankings per-country with precise Stremio catalogs.",
        logo: "https://img.icons8.com/color/256/netflix.png",
        types: [...new Set([movieType, seriesType])],
        catalogs,
        resources: ["catalog"],
        behaviorHints: { configurable: true },
        config: [
            { key: "tmdbApiKey", type: "text", title: "TMDB API Key", required: true }
        ],
    };
}

async function buildCatalog(type, catalogId, apiKey, rpdbApiKey, country, multiCountries) {
    const cacheKey = `${type}_${catalogId}`;
    const cached = getCached(cacheKey);
    let metas = cached.data;
    
    if (!metas || cached.stale) {
        if (cached.data && cached.stale) {
            fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries).catch(() => {});
        } else {
            metas = await fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries);
        }
    }
    
    return (metas || []).map(m => {
        const rpdbP = getRpdbPosterUrl(m.id, rpdbApiKey);
        return { ...m, poster: rpdbP || m.tmdbPoster, tmdbPoster: undefined };
    });
}

async function fetchCatalogFresh(cacheKey, type, catalogId, apiKey, multiCountries) {
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
        
        // --- FLIXPATROL INTEGRATION FOR ROMANIA ---
        if (targetCountry.toLowerCase() === "romania") {
            titles = await fetchFlixPatrolTitles(categoryType);
        } else {
            titles = await fetchNetflixTitles(categoryType, targetCountry);
        }
        // ------------------------------------------
    }

    if (titles.length === 0) return [];

    const metas = (await pMap(titles, (title) => matchTMDB(title, tmdbType, apiKey), 5))
        .filter(v => v !== null && v !== undefined);
    
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
            multiCountries: mc,
            movieType: config.movieType ? config.movieType.trim() : "movie",
            seriesType: config.seriesType ? config.seriesType.trim() : "series"
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
        body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; gap: 24px; }
        .card { width: 100%; max-width: 480px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,0.6); position: relative; z-index:1; }
        .card-header { background: linear-gradient(135deg, #1a0000 0%, #1a0505 50%, #0a0a0a 100%); padding: 36px 36px 28px; border-bottom: 1px solid var(--border); }
        .card-header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; }
        .card-header p { font-size: 13px; color: var(--muted); margin-top: 6px; }
        .logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .logo-n { font-family: 'Bebas Neue', sans-serif; font-size: 38px; color: var(--red); line-height: 1; letter-spacing: -1px; }
        .logo-badge { background: var(--red); color: #fff; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; }
        .week-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 4px 10px; background: rgba(229,9,20,0.1); border: 1px solid rgba(229,9,20,0.2); border-radius: 6px; font-size: 11px; color: #e57373; transition: 0.3s; }
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
        .btn-sm { display: inline-block; width: auto; padding: 8px 18px; font-size: 12px; font-weight: 500; margin-top: 6px; background: rgba(255,255,255,0.1); color: #ccc; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; }
        .btn-sm:hover { background: rgba(255,255,255,0.2); color: #fff; border-color: rgba(255,255,255,0.3); }
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
        .input-with-icon input { padding-right: 48px; }
        .toggle-pwd { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: transparent; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #888; transition: 0.2s; outline: none; }
        .toggle-pwd:hover { color: #fff; transform: translateY(-50%) scale(1.1); }
        
        .field-row { display: flex; flex-direction: column; gap: 0; }
        
        .tooltip-container { position: relative; display: inline-block; margin-left: 6px; }
        .tooltip-icon { background: rgba(255,255,255,0.1); color: #aaa; border-radius: 50%; width: 15px; height: 15px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; cursor: help; text-decoration: none; transition: 0.2s; }
        .tooltip-container:hover .tooltip-icon { background: rgba(255,255,255,0.2); color: #fff; }
        a.tooltip-icon { cursor: pointer; }
        a.tooltip-icon:hover { background: var(--red); color: #fff; transform: scale(1.15); box-shadow: 0 0 10px rgba(229,9,20,0.4); }
        .tooltip-content { visibility: hidden; opacity: 0; position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 8px); background: #222; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; white-space: nowrap; z-index: 100; font-weight: normal; text-transform: none; line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: 0.15s; pointer-events: none; border: 1px solid #333; }
        .tooltip-content a { color: #5c9eff; text-decoration: none; pointer-events: auto; font-weight: bold; }
        .tooltip-content a:hover { text-decoration: underline; }
        .tooltip-container:hover .tooltip-content { visibility: visible; opacity: 1; pointer-events: auto; }
        
        details.advanced-settings { margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(0,0,0,0.1); }
        details.advanced-settings summary { padding: 12px 16px; cursor: pointer; user-select: none; font-weight: 500; outline: none; font-size: 14px; }
        details.advanced-settings summary:hover { background: rgba(255,255,255,0.05); }
        .advanced-settings-content { padding: 16px; border-top: 1px solid var(--border); }
        
        .btn-group { display: flex; gap: 12px; margin-top: 24px; }
        .btn-danger { background: transparent; border: 1px solid #aaa; color: #aaa; }
        .btn-danger:hover { background: rgba(255, 255, 255, 0.1); color: #eee; }
        
        .footer { text-align: center; margin-top: 24px; font-size: 13px; color: #666; width: 100%; max-width: 900px; }
        .footer a { color: #888; text-decoration: none; }
        .footer a:hover { color: #fff; text-decoration: underline; }

        @media (min-width: 800px) {
            .card { max-width: 900px; display: flex; flex-direction: row; }
            .card-header { width: 360px; flex-shrink: 0; border-bottom: none; border-right: 1px solid var(--border); padding: 48px; display: flex; flex-direction: column; justify-content: center; }
            .card-body { flex: 1; min-width: 0; padding: 48px; }
            .field-row { flex-direction: row; gap: 20px; margin-bottom: 20px; }
            .field-row .field { flex: 1; margin-bottom: 0; }
        }
    </style>
</head>
<body>
<div class="card">
    <div class="card-header">
        <div class="logo-row"><span class="logo-n">N</span><span class="logo-badge">Stremio Addon</span></div>
        <h1>Netflix Top 10</h1>
        <p>Dynamic unmerged catalogs per country with correct Stremio metadata matching.</p>
        <div class="week-badge" id="weekBadge"><span>Week of <strong>${latestWeek}</strong></span></div>
    </div>
    <div class="card-body">
        <div class="field">
            <label><span class="required-dot"></span> Country <span class="optional-tag">Reorderable Catalogs</span> 
                <div class="tooltip-container">
                    <span class="tooltip-icon">?</span>
                    <div class="tooltip-content">Click or search to select. Drag tags to re-order Stremio catalogs.</div>
                </div>
            </label>
            <div class="custom-select">
                <input type="text" id="countrySearch" placeholder="Search a country to add..." autocomplete="off">
                <div class="dropdown-list" id="countryDropdown"></div>
            </div>
            <div class="multi-countries" id="selectedCountries"></div>
        </div>
        
        <div class="field">
            <label><span class="required-dot"></span> TMDB API Key 
                <div class="tooltip-container">
                    <a href="https://www.themoviedb.org/settings/api" target="_blank" class="tooltip-icon">?</a>
                    <div class="tooltip-content">Required for metadata.<br>Get yours free at <b style="color:#5c9eff;">themoviedb.org</b></div>
                </div>
            </label>
            <div class="input-with-icon">
                <input type="password" id="tmdbKey" placeholder="e.g. 8a7f3bc2d1...">
                <button class="toggle-pwd" onclick="togglePwd('tmdbKey', this)" title="Show/Hide">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
            </div>
            <div style="margin-top:6px;"><button class="btn btn-sm" id="testKeyBtn" onclick="testTmdbKey()">Test Key</button> <span id="keyStatus" class="key-status"></span></div>
        </div>
        
        <details class="advanced-settings">
            <summary>⚙️ Advanced Settings</summary>
            <div class="advanced-settings-content">
                <div class="field">
                    <label>RPDB API Key <span class="optional-tag">optional</span> 
                        <div class="tooltip-container">
                            <a href="https://ratingposterdb.com/" target="_blank" class="tooltip-icon">?</a>
                            <div class="tooltip-content">Adds Netflix-style rating overlays to posters.<br>Get yours at <b style="color:#5c9eff;">ratingposterdb.com</b></div>
                        </div>
                    </label>
                    <div class="input-with-icon">
                        <input type="password" id="rpdbKey" placeholder="e.g. t1-xxxxxx...">
                        <button class="toggle-pwd" onclick="togglePwd('rpdbKey', this)" title="Show/Hide">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        </button>
                    </div>
                    <div style="margin-top:6px;"><button class="btn btn-sm" id="testRpdbBtn" onclick="testRpdbKey()">Test Format</button> <span id="rpdbStatus" class="key-status"></span></div>
                </div>
                <div class="field" style="margin-bottom: 0;">
                    <label>Catalog Tab Overrides <span class="optional-tag">optional</span> 
                        <div class="tooltip-container">
                            <span class="tooltip-icon">?</span>
                            <div class="tooltip-content">Isolate Netflix content into customizable Discover tabs.</div>
                        </div>
                    </label>
                    <div class="field-row" style="margin-bottom:0; gap:10px;">
                        <input type="text" id="movieOverride" placeholder="Movie Tab Name (e.g. Films)">
                        <input type="text" id="seriesOverride" placeholder="Series Tab Name (e.g. TV Shows)">
                    </div>
                </div>
            </div>
        </details>

        <div class="btn-group">
            <button class="btn btn-primary" id="generateBtn" onclick="generateLink()" style="flex: 2;">Generate Install Link</button>
            <button class="btn btn-danger" onclick="resetForm()" style="flex: 1;" title="Clear Configuration">Clear</button>
        </div>
        <div id="resultArea">
            <p style="font-size:12px;color:#999;">Manifest URL:</p>
            <div class="url-box"><span class="url-box-text" id="manifestDisplayUrl"></span><button class="copy-btn" onclick="copyLink()">Copy</button></div>
            <div class="toast" id="copyToast">✅ Copied to clipboard!</div>
            <button class="btn btn-secondary" onclick="installDirectly()">▶ Install to Stremio</button>
        </div>
    </div>
</div>
<div class="footer">
    Netflix Top 10 Stremio Addon &nbsp;&bull;&nbsp; <a href="https://github.com/C0st1/top10addon" target="_blank">View on GitHub</a>
</div>
<script>
    const availableCountries = ["Global", ...${JSON.stringify(countries)}];
    const serverLatestWeek = "${latestWeek}";
    let selectedCountriesList = [];
    const searchInput = document.getElementById('countrySearch');
    const dropdown = document.getElementById('countryDropdown');
    const selectedContainer = document.getElementById('selectedCountries');

    function updateWeekBadge() {
        const badge = document.getElementById('weekBadge');
        if (!badge) return;
        
        // Dynamically show live status if Romania is selected
        if (selectedCountriesList.some(c => c.toLowerCase() === 'romania')) {
            badge.innerHTML = '<span>Status: <strong>Live Data (Today)</strong></span>';
            badge.style.color = '#2ecc71';
            badge.style.background = 'rgba(46, 204, 113, 0.1)';
            badge.style.borderColor = 'rgba(46, 204, 113, 0.3)';
        } else {
            badge.innerHTML = \`<span>Week of <strong>\${serverLatestWeek}</strong></span>\`;
            badge.style.color = '#e57373';
            badge.style.background = 'rgba(229,9,20,0.1)';
            badge.style.borderColor = 'rgba(229,9,20,0.2)';
        }
    }

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
                        dropdown.classList.remove('open');
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
        updateWeekBadge(); // Trigger badge update on render
    }

    function saveState() {
        try { localStorage.setItem('nf_top10_config', JSON.stringify({ tmdbKey: document.getElementById('tmdbKey').value, rpdbKey: document.getElementById('rpdbKey').value, movieOverride: document.getElementById('movieOverride').value, seriesOverride: document.getElementById('seriesOverride').value, countries: selectedCountriesList })); } catch {}
    }

    (function restoreState() {
        let s = {};
        try {
            const urlMatch = window.location.pathname.match(new RegExp('^/([^/]+)/configure$'));
            if (urlMatch) {
                const decoded = JSON.parse(decodeURIComponent(urlMatch[1]));
                s = {
                    tmdbKey: decoded.tmdbApiKey || "",
                    rpdbKey: decoded.rpdbApiKey || "",
                    movieOverride: decoded.movieType && decoded.movieType !== "movie" ? decoded.movieType : "",
                    seriesOverride: decoded.seriesType && decoded.seriesType !== "series" ? decoded.seriesType : "",
                    countries: decoded.country ? decoded.country.split(",").map(c=>c.trim()) : []
                };
            } else {
                s = JSON.parse(localStorage.getItem('nf_top10_config') || '{}');
            }
        } catch { 
            try { s = JSON.parse(localStorage.getItem('nf_top10_config') || '{}'); } catch {}
        }
        
        try {
            if (s.tmdbKey) document.getElementById('tmdbKey').value = s.tmdbKey;
            if (s.rpdbKey) document.getElementById('rpdbKey').value = s.rpdbKey;
            if (s.movieOverride) document.getElementById('movieOverride').value = s.movieOverride;
            if (s.seriesOverride) document.getElementById('seriesOverride').value = s.seriesOverride;
            if (s.countries && s.countries.length > 0) s.countries.forEach(c => addCountry(c)); else addCountry('Global');
        } catch { addCountry('Global'); }
    })();

    async function testTmdbKey() {
        const key = document.getElementById('tmdbKey').value.trim();
        const stat = document.getElementById('keyStatus');
        if (!key) { stat.textContent = '❌ Key is empty'; stat.className = 'key-status error'; return; }
        stat.textContent = 'Testing...';
        try { const r = await fetch('/api/index.js/validate-tmdb-key', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
              const d = await r.json(); stat.textContent = d.valid ? '✅ Valid key' : '❌ Invalid key'; } 
        catch { stat.textContent = '❌ Error'; }
    }
    
    function testRpdbKey() {
        const key = document.getElementById('rpdbKey').value.trim();
        const stat = document.getElementById('rpdbStatus');
        if (!key) { stat.textContent = '❌ Key is empty'; stat.className = 'key-status error'; return; }
        stat.className = 'key-status';
        if (key.length >= 8 && /^[a-zA-Z0-9-]+$/.test(key)) {
            stat.textContent = '✅ Format looks good';
            stat.className = 'key-status success';
        } else {
            stat.textContent = '⚠️ Double check format';
            stat.className = 'key-status error';
        }
    }
    
    function resetForm() {
        if (!confirm("Are you sure you want to completely wipe your configuration?")) return;
        document.getElementById('tmdbKey').value = '';
        document.getElementById('rpdbKey').value = '';
        document.getElementById('movieOverride').value = '';
        document.getElementById('seriesOverride').value = '';
        document.getElementById('keyStatus').textContent = '';
        document.getElementById('rpdbStatus').textContent = '';
        document.getElementById('resultArea').style.display = 'none';
        
        localStorage.removeItem('nf_top10_config');
        selectedCountriesList = [];
        addCountry('Global');
        searchInput.value = '';
        renderDropdown('');
    }

    let currentManifestUrl = "";
    function generateLink() {
        saveState();
        const tmdbKey = document.getElementById('tmdbKey').value.trim();
        const rpdbKey = document.getElementById('rpdbKey').value.trim();
        if (!tmdbKey) return;
        
        let cfg = { tmdbApiKey: tmdbKey, country: selectedCountriesList.join(',') };
        if (rpdbKey) cfg.rpdbApiKey = rpdbKey;
        const mo = document.getElementById('movieOverride').value.trim();
        const so = document.getElementById('seriesOverride').value.trim();
        if (mo) cfg.movieType = mo;
        if (so) cfg.seriesType = so;
        
        currentManifestUrl = window.location.origin + '/' + encodeURIComponent(JSON.stringify(cfg)) + '/manifest.json';
        document.getElementById('manifestDisplayUrl').textContent = currentManifestUrl;
        document.getElementById('resultArea').style.display = 'block';
    }
    
    const eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    const eyeOffSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

    function togglePwd(id, btn) {
        const input = document.getElementById(id);
        if (input.type === 'password') { input.type = 'text'; btn.innerHTML = eyeOffSvg; }
        else { input.type = 'password'; btn.innerHTML = eyeSvg; }
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
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Max-Age", "86400");
        return res.status(200).end();
    }

    let path = req.url;
    if (path.startsWith('/api/index.js')) path = path.replace('/api/index.js', '');
    if (path === "") path = "/";

    if (path === "/" || path === "/configure" || path.endsWith("/configure")) {
        const [countries, latestWeek] = await Promise.all([getAvailableCountries(), getLatestWeekDate()]);
        return res.status(200).setHeader("Content-Type", "text/html;charset=UTF-8").send(await buildConfigHTML(countries, latestWeek));
    }

    if (path === "/health") {
        const tsvTs = getTsvTimestamp();
        res.setHeader("Cache-Control", "no-cache");
        return res.status(200).json({ status: "ok", lastTsvFetch: tsvTs > 0 ? new Date(tsvTs).toISOString() : null, time: new Date().toISOString() });
    }

    if (path === "/validate-tmdb-key" && req.method === "POST") {
        let body = {};
        if (req.body) body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        else try { 
            const bufs = []; let length = 0;
            for await (const c of req) {
                bufs.push(c); length += c.length;
                if (length > 1e5) break; 
            } 
            body = JSON.parse(Buffer.concat(bufs).toString()); 
        } catch {}
        return res.status(200).json(await validateTmdbKey(body.apiKey || ""));
    }

    if (path.endsWith("/manifest.json")) {
        const configStr = path.replace("/manifest.json", "").replace(/^\//, "");
        let cc = "Global", mcs = [], mType = "movie", sType = "series";
        try { 
            const cfg = JSON.parse(decodeURIComponent(configStr)); 
            if (cfg.country) { mcs = cfg.country.split(",").map(c=>c.trim()).filter(c=>c); cc = mcs[0]; } 
            if (cfg.movieType) mType = cfg.movieType;
            if (cfg.seriesType) sType = cfg.seriesType;
        } catch {}
        res.setHeader("Cache-Control", "public, max-age=14400, stale-while-revalidate=43200");
        return res.status(200).setHeader("Content-Type", "application/json").json(buildManifest(cc, mcs, mType, sType));
    }

    const match = path.match(/^\/(.*?)\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
    if (match) {
        const config = parseConfig(match[1]);
        if (!config) return res.status(400).json({ error: "Missing/Invalid config" });
        const catalogType = match[3].includes("movies_") ? "movie" : "series";
        const metas = await buildCatalog(catalogType, match[3], config.tmdbApiKey, config.rpdbApiKey, config.country, config.multiCountries);
        res.setHeader("Cache-Control", "public, max-age=14400, stale-while-revalidate=43200");
        return res.status(200).setHeader("Content-Type", "application/json").json({ metas });
    }

    return res.status(404).send("Not Found");
};
