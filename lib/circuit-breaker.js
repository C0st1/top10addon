// ============================================================
// Circuit Breaker — Prevent cascading failures from external APIs
// Implements REC-10: Circuit breaker for external service calls
// ============================================================

/**
 * Circuit breaker states
 */
const CircuitState = {
    CLOSED: 'closed',     // Normal operation, requests pass through
    OPEN: 'open',         // Failing, requests are blocked
    HALF_OPEN: 'half_open', // Testing if service recovered
};

/**
 * Circuit Breaker configuration
 */
const DEFAULT_CONFIG = {
    failureThreshold: 5,      // Number of failures before opening
    successThreshold: 3,      // Number of successes in half-open to close
    timeout: 30000,           // Time in ms before attempting recovery
    monitoringWindow: 60000,  // Window for counting failures
};

/**
 * Circuit Breaker class for protecting external service calls
 */
class CircuitBreaker {
    /**
     * @param {string} name - Service name for logging
     * @param {Object} [config] - Configuration options
     */
    constructor(name, config = {}) {
        this.name = name;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.openedAt = null;
        this.failures = []; // Timestamp of recent failures
    }

    /**
     * Check if requests should be allowed
     * @returns {{ allowed: boolean, state: string }}
     */
    canExecute() {
        const now = Date.now();

        // Clean up old failures outside monitoring window
        this.failures = this.failures.filter(t => now - t < this.config.monitoringWindow);

        switch (this.state) {
            case CircuitState.CLOSED:
                return { allowed: true, state: this.state };

            case CircuitState.OPEN:
                // Check if timeout has passed
                if (now - this.openedAt >= this.config.timeout) {
                    this.state = CircuitState.HALF_OPEN;
                    this.successCount = 0;
                    return { allowed: true, state: this.state };
                }
                return { allowed: false, state: this.state };

            case CircuitState.HALF_OPEN:
                return { allowed: true, state: this.state };

            default:
                return { allowed: true, state: this.state };
        }
    }

    /**
     * Record a successful call
     */
    recordSuccess() {
        this.failureCount = 0;

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.failures = [];
            }
        }
    }

    /**
     * Record a failed call
     */
    recordFailure() {
        const now = Date.now();
        this.failures.push(now);
        this.failureCount = this.failures.length;
        this.lastFailureTime = now;

        if (this.state === CircuitState.HALF_OPEN) {
            // Failure in half-open -> back to open
            this.state = CircuitState.OPEN;
            this.openedAt = now;
        } else if (this.state === CircuitState.CLOSED) {
            if (this.failureCount >= this.config.failureThreshold) {
                this.state = CircuitState.OPEN;
                this.openedAt = now;
            }
        }
    }

    /**
     * Execute a function with circuit breaker protection
     * @template T
     * @param {() => Promise<T>} fn - Async function to execute
     * @returns {Promise<T>}
     * @throws {Error} If circuit is open or function fails
     */
    async execute(fn) {
        const check = this.canExecute();

        if (!check.allowed) {
            throw new Error(`Circuit breaker [${this.name}] is OPEN - service unavailable`);
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    /**
     * Execute with fallback if circuit is open
     * @template T
     * @param {() => Promise<T>} fn - Async function to execute
     * @param {() => T} fallback - Fallback function if circuit is open
     * @returns {Promise<T>}
     */
    async executeWithFallback(fn, fallback) {
        const check = this.canExecute();

        if (!check.allowed) {
            return fallback();
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            return fallback();
        }
    }

    /**
     * Get current status
     * @returns {Object}
     */
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            openedAt: this.openedAt,
        };
    }

    /**
     * Force reset the circuit breaker
     */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.failures = [];
        this.openedAt = null;
    }
}

/**
 * Circuit breaker instances for external services
 */
const circuitBreakers = {
    tmdb: new CircuitBreaker('tmdb', {
        failureThreshold: 5,
        timeout: 30000,
        monitoringWindow: 60000,
    }),
    flixpatrol: new CircuitBreaker('flixpatrol', {
        failureThreshold: 3,
        timeout: 60000,
        monitoringWindow: 120000,
    }),
    rpdb: new CircuitBreaker('rpdb', {
        failureThreshold: 5,
        timeout: 30000,
        monitoringWindow: 60000,
    }),
};

/**
 * Get a circuit breaker by name
 * @param {string} name
 * @returns {CircuitBreaker}
 */
function getCircuitBreaker(name) {
    return circuitBreakers[name] || null;
}

/**
 * Get all circuit breaker statuses
 * @returns {Object}
 */
function getAllCircuitBreakerStatuses() {
    const statuses = {};
    for (const [name, cb] of Object.entries(circuitBreakers)) {
        statuses[name] = cb.getStatus();
    }
    return statuses;
}

module.exports = {
    CircuitBreaker,
    CircuitState,
    circuitBreakers,
    getCircuitBreaker,
    getAllCircuitBreakerStatuses,
};
