// ============================================================
// Vercel / Node.js Server — Netflix Top 10 Stremio Addon v3.5.0
// ARCH-01 FIX: Thin routing layer; logic in lib/ modules
// ============================================================

const { buildConfigHTML } = require('../lib/template');
const { fetchFlixPatrolTitles, getAvailableCountries } = require('../lib/scraper');
const { buildManifest, buildCatalog } = require('../lib/manifest');
const { validateTmdbKey } = require('../lib/tmdb');
const { saveConfig, getConfig, parseConfig, normalizeConfig } = require('../lib/config-store');
const { toIdSlug } = require('../lib/utils');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Max-Age", "86400");
        return res.status(200).end();
    }

    // Normalize path
    let path = req.url;
    if (path.startsWith('/api/index.js')) path = path.replace('/api/index.js', '');
    if (path === "") path = "/";

    // Strip query string for routing
    const pathWithoutQuery = path.split('?')[0];

    // -----------------------------------------------
    // Configuration page
    // -----------------------------------------------
    if (pathWithoutQuery === "/" || pathWithoutQuery === "/configure") {
        const countries = getAvailableCountries();
        return res.status(200)
            .setHeader("Content-Type", "text/html;charset=UTF-8")
            .send(buildConfigHTML(countries));
    }

    // -----------------------------------------------
    // Health check
    // -----------------------------------------------
    if (pathWithoutQuery === "/health") {
        res.setHeader("Cache-Control", "no-cache");
        return res.status(200).json({
            status: "ok",
            type: "flixpatrol_scraper",
            version: require('../lib/constants').VERSION,
            time: new Date().toISOString()
        });
    }

    // -----------------------------------------------
    // API: Validate TMDB key
    // -----------------------------------------------
    if (pathWithoutQuery === "/api/validate-tmdb-key" && req.method === "POST") {
        let body = {};
        if (req.body) {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
            try {
                const bufs = [];
                let length = 0;
                for await (const c of req) {
                    bufs.push(c);
                    length += c.length;
                    if (length > 1e5) break;
                }
                body = JSON.parse(Buffer.concat(bufs).toString());
            } catch (e) {
                console.warn('[API] Failed to parse validate-tmdb-key body:', e.message);
            }
        }
        return res.status(200).json(await validateTmdbKey(body.apiKey || ""));
    }

    // -----------------------------------------------
    // API: Save config (SEC-02 FIX — opaque tokens)
    // -----------------------------------------------
    if (pathWithoutQuery === "/api/save-config" && req.method === "POST") {
        let body = {};
        if (req.body) {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
            try {
                const bufs = [];
                let length = 0;
                for await (const c of req) {
                    bufs.push(c);
                    length += c.length;
                    if (length > 1e5) break;
                }
                body = JSON.parse(Buffer.concat(bufs).toString());
            } catch (e) {
                console.warn('[API] Failed to parse save-config body:', e.message);
                return res.status(400).json({ error: "Invalid request body" });
            }
        }

        if (!body.tmdbApiKey?.trim()) {
            return res.status(400).json({ error: "TMDB API key is required" });
        }

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'];
        const baseUrl = `${protocol}://${host}`;

        try {
            const result = saveConfig(body, baseUrl);
            return res.status(200).json({
                token: result.token,
                manifestUrl: result.manifestUrl,
                installUrl: result.installUrl
            });
        } catch (e) {
            console.error('[API] Failed to save config:', e.message);
            return res.status(500).json({ error: "Failed to save configuration" });
        }
    }

    // -----------------------------------------------
    // Configuration page (Stremio addon config route)
    // Stremio derives this URL from the manifest location:
    //   manifest: /{token}/manifest.json  →  config: /{token}/config
    // -----------------------------------------------
    const configPageMatch = pathWithoutQuery.match(/^\/([^/]+)\/config$/);
    if (configPageMatch) {
        const countries = getAvailableCountries();
        return res.status(200)
            .setHeader("Content-Type", "text/html;charset=UTF-8")
            .send(buildConfigHTML(countries));
    }

    // -----------------------------------------------
    // Manifest: /{token}/manifest.json
    // -----------------------------------------------
    if (pathWithoutQuery.endsWith("/manifest.json")) {
        const token = pathWithoutQuery.replace("/manifest.json", "").replace(/^\//, "");

        // SEC-02 FIX: Look up config by opaque token
        const config = getConfig(token);
        if (config) {
            const norm = normalizeConfig(config);
            res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
            return res.status(200)
                .setHeader("Content-Type", "application/json")
                .json(buildManifest(norm.country, norm.multiCountries, norm.movieType, norm.seriesType));
        }

        // Backward compatibility: try parsing as legacy encoded config
        const legacyConfig = parseConfig(token);
        if (legacyConfig) {
            console.warn('[API] Legacy encoded config URL detected — consider regenerating install link');
            res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
            return res.status(200)
                .setHeader("Content-Type", "application/json")
                .json(buildManifest(legacyConfig.country, legacyConfig.multiCountries, legacyConfig.movieType, legacyConfig.seriesType));
        }

        return res.status(404).json({ error: "Configuration not found. Please regenerate your install link." });
    }

    // -----------------------------------------------
    // Catalog: /{token}/catalog/{type}/{id}.json
    // -----------------------------------------------
    const catalogMatch = pathWithoutQuery.match(/^\/(.*?)\/catalog\/([^/]+)\/([^/.]+)(?:\.json)?$/);
    if (catalogMatch) {
        const token = catalogMatch[1];
        const config = getConfig(token);
        let norm = null;

        if (config) {
            norm = normalizeConfig(config);
        } else {
            // Backward compatibility: try legacy encoded config
            norm = parseConfig(token);
            if (norm) {
                console.warn('[API] Legacy encoded config URL detected for catalog request');
            }
        }

        if (!norm) {
            return res.status(400).json({ error: "Missing or invalid configuration. Please regenerate your install link." });
        }

        const catalogType = catalogMatch[3].includes("movies_") ? "movie" : "series";
        const metas = await buildCatalog(
            catalogType, catalogMatch[3],
            norm.tmdbApiKey, norm.rpdbApiKey,
            norm.multiCountries
        );

        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");
        return res.status(200)
            .setHeader("Content-Type", "application/json")
            .json({ metas });
    }

    // -----------------------------------------------
    // 404
    // -----------------------------------------------
    return res.status(404).send("Not Found");
};
