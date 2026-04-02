// ============================================================
// Health Check Endpoint — enhanced health reporting
// ============================================================

import { VERSION } from './constants.js';

export interface HealthCacheStats {
    flixpatrolSize: number;
    tmdbSize: number;
    imdbSize: number;
    configSize: number;
}

export interface HealthReport {
    status: string;
    type: string;
    version: string;
    time: string;
    uptime: number;
    memory: {
        rss: number;
        heapUsed: number;
        heapTotal: number;
    };
    cacheStats?: HealthCacheStats;
}

/**
 * Generate a health report for the /health endpoint.
 *
 * @param cacheStats - Optional cache statistics from all caches
 * @returns Health report object
 */
export function getHealthReport(cacheStats?: HealthCacheStats): HealthReport {
    const mem = process.memoryUsage();
    return {
        status: 'ok',
        type: 'flixpatrol_scraper',
        version: VERSION,
        time: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
        ...(cacheStats ? { cacheStats } : {}),
    };
}
