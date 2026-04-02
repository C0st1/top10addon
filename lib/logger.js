// ============================================================
// Structured Logger — JSON logging for cloud environments
// Implements REC-5: Structured logging for easier parsing
// ============================================================

const { VERSION } = require('./constants');

/**
 * Log level enumeration
 */
const LogLevel = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
};

/**
 * Minimum log level to output (default: INFO)
 * Can be overridden via LOG_LEVEL environment variable
 */
const minLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

/**
 * Priority map for log level comparison
 */
const logLevelPriority = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};

/**
 * Check if a log level should be output
 * @param {string} level
 * @returns {boolean}
 */
function shouldLog(level) {
    const currentPriority = logLevelPriority[level] ?? 1;
    const minPriority = logLevelPriority[minLogLevel] ?? 1;
    return currentPriority >= minPriority;
}

/**
 * Format a log entry as JSON
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} [data] - Additional structured data
 * @param {string} [requestId] - Request ID for tracing
 * @returns {string} JSON-formatted log line
 */
function formatLogEntry(level, message, data = null, requestId = null) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        service: 'netflix-top10-addon',
        version: VERSION,
    };

    if (requestId) {
        entry.requestId = requestId;
    }

    if (data && Object.keys(data).length > 0) {
        entry.data = data;
    }

    return JSON.stringify(entry);
}

/**
 * Create a logger instance with optional request context
 * @param {string} [requestId] - Request ID for tracing all logs in this context
 * @returns {Object} Logger instance
 */
function createLogger(requestId = null) {
    return {
        /**
         * Log debug message
         * @param {string} message
         * @param {Object} [data]
         */
        debug(message, data) {
            if (shouldLog(LogLevel.DEBUG)) {
                console.debug(formatLogEntry(LogLevel.DEBUG, message, data, requestId));
            }
        },

        /**
         * Log info message
         * @param {string} message
         * @param {Object} [data]
         */
        info(message, data) {
            if (shouldLog(LogLevel.INFO)) {
                console.info(formatLogEntry(LogLevel.INFO, message, data, requestId));
            }
        },

        /**
         * Log warning message
         * @param {string} message
         * @param {Object} [data]
         */
        warn(message, data) {
            if (shouldLog(LogLevel.WARN)) {
                console.warn(formatLogEntry(LogLevel.WARN, message, data, requestId));
            }
        },

        /**
         * Log error message
         * @param {string} message
         * @param {Object} [data]
         */
        error(message, data) {
            if (shouldLog(LogLevel.ERROR)) {
                console.error(formatLogEntry(LogLevel.ERROR, message, data, requestId));
            }
        },

        /**
         * Log with a new request ID (for sub-operations)
         * @param {string} newRequestId
         * @returns {Object} New logger instance
         */
        withRequestId(newRequestId) {
            return createLogger(newRequestId);
        },

        /**
         * Get the current request ID
         * @returns {string|null}
         */
        getRequestId() {
            return requestId;
        },
    };
}

/**
 * Global logger instance (no request context)
 */
const logger = createLogger();

module.exports = {
    logger,
    createLogger,
    LogLevel,
};
