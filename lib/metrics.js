// ============================================================
// Metrics Export — Prometheus-compatible metrics
// Implements REC-12: Monitoring/metrics export
// ============================================================

const { VERSION } = require('./constants');

/**
 * Metric types
 */
const MetricType = {
    COUNTER: 'counter',
    GAUGE: 'gauge',
    HISTOGRAM: 'histogram',
};

/**
 * In-memory metrics store
 */
class MetricsRegistry {
    constructor() {
        this.metrics = new Map();
        this.counters = new Map();
        this.gauges = new Map();
        this.histograms = new Map();
    }

    /**
     * Register a metric
     * @param {string} name
     * @param {string} type
     * @param {string} help
     * @param {string[]} [labels]
     */
    register(name, type, help, labels = []) {
        this.metrics.set(name, { name, type, help, labels });

        switch (type) {
            case MetricType.COUNTER:
                this.counters.set(name, new Map());
                break;
            case MetricType.GAUGE:
                this.gauges.set(name, new Map());
                break;
            case MetricType.HISTOGRAM:
                this.histograms.set(name, { buckets: new Map(), sum: 0, count: 0 });
                break;
        }
    }

    /**
     * Increment a counter
     * @param {string} name
     * @param {Object} [labels]
     * @param {number} [value=1]
     */
    incrementCounter(name, labels = {}, value = 1) {
        if (!this.counters.has(name)) {
            this.register(name, MetricType.COUNTER, `Counter: ${name}`);
        }
        const key = this._labelsKey(labels);
        const current = this.counters.get(name).get(key) || 0;
        this.counters.get(name).set(key, current + value);
    }

    /**
     * Set a gauge value
     * @param {string} name
     * @param {number} value
     * @param {Object} [labels]
     */
    setGauge(name, value, labels = {}) {
        if (!this.gauges.has(name)) {
            this.register(name, MetricType.GAUGE, `Gauge: ${name}`);
        }
        const key = this._labelsKey(labels);
        this.gauges.get(name).set(key, value);
    }

    /**
     * Observe a value for histogram
     * @param {string} name
     * @param {number} value
     * @param {Object} [labels]
     */
    observe(name, value, labels = {}) {
        if (!this.histograms.has(name)) {
            this.register(name, MetricType.HISTOGRAM, `Histogram: ${name}`);
        }
        const histogram = this.histograms.get(name);
        histogram.sum += value;
        histogram.count++;

        // Default buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
        const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        for (const bucket of buckets) {
            if (value <= bucket) {
                const key = `le="${bucket}"`;
                histogram.buckets.set(key, (histogram.buckets.get(key) || 0) + 1);
            }
        }
        // +Inf bucket
        histogram.buckets.set('le="+Inf"', (histogram.buckets.get('le="+Inf"') || 0) + 1);
    }

    /**
     * Generate labels key for storage
     * @private
     */
    _labelsKey(labels) {
        if (!labels || Object.keys(labels).length === 0) {
            return '';
        }
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }

    /**
     * Export metrics in Prometheus format
     * @returns {string}
     */
    export() {
        const lines = [];

        // Add process info
        lines.push(`# HELP netflix_top10_version Application version info`);
        lines.push(`# TYPE netflix_top10_version gauge`);
        lines.push(`netflix_top10_version{version="${VERSION}"} 1`);
        lines.push('');

        // Export counters
        for (const [name, values] of this.counters) {
            const metric = this.metrics.get(name);
            if (metric) {
                lines.push(`# HELP ${name} ${metric.help}`);
                lines.push(`# TYPE ${name} counter`);
            }
            for (const [labelKey, value] of values) {
                if (labelKey) {
                    lines.push(`${name}{${labelKey}} ${value}`);
                } else {
                    lines.push(`${name} ${value}`);
                }
            }
            lines.push('');
        }

        // Export gauges
        for (const [name, values] of this.gauges) {
            const metric = this.metrics.get(name);
            if (metric) {
                lines.push(`# HELP ${name} ${metric.help}`);
                lines.push(`# TYPE ${name} gauge`);
            }
            for (const [labelKey, value] of values) {
                if (labelKey) {
                    lines.push(`${name}{${labelKey}} ${value}`);
                } else {
                    lines.push(`${name} ${value}`);
                }
            }
            lines.push('');
        }

        // Export histograms
        for (const [name, histogram] of this.histograms) {
            const metric = this.metrics.get(name);
            if (metric) {
                lines.push(`# HELP ${name} ${metric.help}`);
                lines.push(`# TYPE ${name} histogram`);
            }

            // Export buckets
            for (const [bucketKey, count] of histogram.buckets) {
                lines.push(`${name}_bucket{${bucketKey}} ${count}`);
            }

            // Export sum and count
            lines.push(`${name}_sum ${histogram.sum}`);
            lines.push(`${name}_count ${histogram.count}`);
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Reset all metrics
     */
    reset() {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
}

/**
 * Global metrics registry
 */
const metrics = new MetricsRegistry();

// Pre-register common metrics
metrics.register('http_requests_total', MetricType.COUNTER, 'Total HTTP requests');
metrics.register('http_request_duration_seconds', MetricType.HISTOGRAM, 'HTTP request duration');
metrics.register('http_requests_in_flight', MetricType.GAUGE, 'Current in-flight requests');
metrics.register('cache_hits_total', MetricType.COUNTER, 'Cache hit count');
metrics.register('cache_misses_total', MetricType.COUNTER, 'Cache miss count');
metrics.register('external_api_requests_total', MetricType.COUNTER, 'External API request count');
metrics.register('external_api_errors_total', MetricType.COUNTER, 'External API error count');
metrics.register('rate_limit_exceeded_total', MetricType.COUNTER, 'Rate limit exceeded count');

/**
 * Track HTTP request metrics
 * @param {string} method
 * @param {string} path
 * @param {number} statusCode
 * @param {number} durationMs
 */
function trackHttpRequest(method, path, statusCode, durationMs) {
    metrics.incrementCounter('http_requests_total', { method, path, status: String(statusCode) });
    metrics.observe('http_request_duration_seconds', durationMs / 1000, { method, path });
}

/**
 * Track cache operation
 * @param {boolean} hit
 * @param {string} [cacheName]
 */
function trackCacheOperation(hit, cacheName = 'default') {
    if (hit) {
        metrics.incrementCounter('cache_hits_total', { cache: cacheName });
    } else {
        metrics.incrementCounter('cache_misses_total', { cache: cacheName });
    }
}

/**
 * Track external API call
 * @param {string} service
 * @param {boolean} success
 */
function trackExternalApiCall(service, success) {
    metrics.incrementCounter('external_api_requests_total', { service });
    if (!success) {
        metrics.incrementCounter('external_api_errors_total', { service });
    }
}

/**
 * Track rate limit exceeded
 * @param {string} route
 */
function trackRateLimitExceeded(route) {
    metrics.incrementCounter('rate_limit_exceeded_total', { route });
}

module.exports = {
    metrics,
    MetricsRegistry,
    MetricType,
    trackHttpRequest,
    trackCacheOperation,
    trackExternalApiCall,
    trackRateLimitExceeded,
};
