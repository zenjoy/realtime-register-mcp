/**
 * Circuit Breaker implementation with exponential backoff for RealtimeRegister API integration
 *
 * Provides fault tolerance by temporarily blocking requests when failures exceed thresholds
 * and gradually allowing requests back through with exponential backoff
 */

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  /** Failure threshold to trigger open state */
  failureThreshold: number;
  /** Success threshold to close from half-open state */
  successThreshold: number;
  /** Time window for tracking failures (in milliseconds) */
  monitoringPeriod: number;
  /** Initial timeout before transitioning to half-open (in milliseconds) */
  timeout: number;
  /** Maximum timeout cap for exponential backoff (in milliseconds) */
  maxTimeout: number;
  /** Exponential backoff multiplier (e.g., 2.0 for doubling) */
  backoffMultiplier: number;
  /** Reset timeout to initial value after this many successful operations */
  resetThreshold: number;
}

export interface CircuitBreakerResult<T> {
  /** Whether the request was allowed through the circuit breaker */
  allowed: boolean;
  /** The result of the operation (if allowed and successful) */
  result?: T;
  /** Error from the operation (if allowed but failed) */
  error?: Error;
  /** Current circuit breaker state */
  state: CircuitBreakerState;
  /** Time until circuit breaker might allow requests (if OPEN) */
  retryAfter?: number;
  /** Current failure count in the monitoring window */
  currentFailures: number;
  /** Current success count (relevant in HALF_OPEN state) */
  currentSuccesses: number;
}

export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  currentFailures: number;
  currentTimeout: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  stateChangedAt: number;
  timeUntilRetry: number;
}

/**
 * Circuit Breaker with Exponential Backoff
 *
 * States:
 * - CLOSED: Normal operation, all requests pass through
 * - OPEN: Failures exceeded threshold, all requests blocked
 * - HALF_OPEN: Testing if service has recovered, limited requests allowed
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private consecutiveSuccesses = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private currentTimeout: number;
  private stateChangedAt: number = Date.now();
  private failures: number[] = []; // Timestamps of failures within monitoring period
  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.currentTimeout = config.timeout;
    this.validateConfig();
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
    this.totalRequests++;
    this.cleanupOldFailures();

    if (!this.shouldAllowRequest()) {
      return {
        allowed: false,
        state: this.state,
        retryAfter: this.getRetryAfter(),
        currentFailures: this.failureCount,
        currentSuccesses: this.successCount,
      };
    }

    try {
      const result = await operation();
      this.onSuccess();
      return {
        allowed: true,
        result,
        state: this.state,
        currentFailures: this.failureCount,
        currentSuccesses: this.successCount,
      };
    } catch (error) {
      this.onFailure();
      return {
        allowed: true,
        error: error instanceof Error ? error : new Error(String(error)),
        state: this.state,
        currentFailures: this.failureCount,
        currentSuccesses: this.successCount,
      };
    }
  }

  /**
   * Check if a request should be allowed through the circuit breaker
   */
  shouldAllowRequest(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (now - this.stateChangedAt >= this.currentTimeout) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        // In half-open state, we allow a limited number of requests to test the service
        return this.successCount < this.config.successThreshold;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   */
  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.totalSuccesses++;
    this.consecutiveSuccesses++;
    this.failureCount = Math.max(0, this.failureCount - 1); // Gradually reduce failure count

    switch (this.state) {
      case CircuitBreakerState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;

      case CircuitBreakerState.CLOSED:
        // Reset timeout if we've had enough consecutive successes
        if (this.consecutiveSuccesses >= this.config.resetThreshold) {
          this.currentTimeout = this.config.timeout;
        }
        break;
    }
  }

  /**
   * Record a failed operation
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.totalFailures++;
    this.failureCount++;
    this.consecutiveSuccesses = 0;
    this.failures.push(now);

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        // Any failure in half-open state immediately returns to open
        this.transitionToOpen();
        break;
    }
  }

  /**
   * Transition to OPEN state with exponential backoff
   */
  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.stateChangedAt = Date.now();
    this.successCount = 0;

    // Apply exponential backoff, but cap at maxTimeout
    this.currentTimeout = Math.min(
      this.currentTimeout * this.config.backoffMultiplier,
      this.config.maxTimeout
    );
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.stateChangedAt = Date.now();
    this.successCount = 0;
  }

  /**
   * Transition to CLOSED state and reset counters
   */
  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.stateChangedAt = Date.now();
    this.failureCount = 0;
    this.successCount = 0;
    // Partially reset timeout on successful recovery
    this.currentTimeout = Math.max(
      this.config.timeout,
      this.currentTimeout / this.config.backoffMultiplier
    );
  }

  /**
   * Clean up old failures outside the monitoring period
   */
  private cleanupOldFailures(): void {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;
    this.failures = this.failures.filter((timestamp) => timestamp > cutoffTime);

    // Update failure count based on failures within monitoring period
    this.failureCount = this.failures.length;
  }

  /**
   * Get time until retry is allowed (in milliseconds)
   */
  private getRetryAfter(): number {
    if (this.state !== CircuitBreakerState.OPEN) {
      return 0;
    }

    const timeElapsed = Date.now() - this.stateChangedAt;
    return Math.max(0, this.currentTimeout - timeElapsed);
  }

  /**
   * Get current circuit breaker metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      consecutiveFailures: this.state === CircuitBreakerState.OPEN ? this.failureCount : 0,
      consecutiveSuccesses: this.consecutiveSuccesses,
      currentFailures: this.failureCount,
      currentTimeout: this.currentTimeout,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateChangedAt: this.stateChangedAt,
      timeUntilRetry: this.getRetryAfter(),
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Reset circuit breaker to initial state (useful for testing)
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveSuccesses = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.currentTimeout = this.config.timeout;
    this.stateChangedAt = Date.now();
    this.failures = [];
  }

  /**
   * Force circuit breaker to a specific state (for testing)
   */
  forceState(state: CircuitBreakerState): void {
    this.state = state;
    this.stateChangedAt = Date.now();

    if (state === CircuitBreakerState.HALF_OPEN) {
      this.successCount = 0;
    }
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(): void {
    const {
      failureThreshold,
      successThreshold,
      monitoringPeriod,
      timeout,
      maxTimeout,
      backoffMultiplier,
      resetThreshold,
    } = this.config;

    if (failureThreshold <= 0) {
      throw new Error('Failure threshold must be greater than 0');
    }

    if (successThreshold <= 0) {
      throw new Error('Success threshold must be greater than 0');
    }

    if (monitoringPeriod <= 0) {
      throw new Error('Monitoring period must be greater than 0');
    }

    if (timeout <= 0) {
      throw new Error('Timeout must be greater than 0');
    }

    if (maxTimeout < timeout) {
      throw new Error('Max timeout must be greater than or equal to initial timeout');
    }

    if (backoffMultiplier <= 1) {
      throw new Error('Backoff multiplier must be greater than 1');
    }

    if (resetThreshold <= 0) {
      throw new Error('Reset threshold must be greater than 0');
    }
  }
}

/**
 * Circuit breaker error thrown when requests are blocked
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly metrics: CircuitBreakerMetrics,
    public readonly retryAfter: number
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Factory for creating circuit breakers with common configurations
 */
export class CircuitBreakerFactory {
  /**
   * Create a circuit breaker for RealtimeRegister API (conservative settings)
   */
  static forRealtimeRegister(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 5, // 5 failures to open
      successThreshold: 3, // 3 successes to close from half-open
      monitoringPeriod: 300000, // 5 minute monitoring window
      timeout: 60000, // 1 minute initial timeout
      maxTimeout: 600000, // 10 minute maximum timeout
      backoffMultiplier: 2.0, // Double the timeout on each failure cycle
      resetThreshold: 10, // Reset timeout after 10 consecutive successes
    });
  }

  /**
   * Create a circuit breaker for development/testing (more lenient)
   */
  static forDevelopment(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 10, // 10 failures to open (more lenient)
      successThreshold: 2, // 2 successes to close
      monitoringPeriod: 120000, // 2 minute monitoring window
      timeout: 30000, // 30 second initial timeout
      maxTimeout: 300000, // 5 minute maximum timeout
      backoffMultiplier: 1.5, // 1.5x multiplier (slower backoff)
      resetThreshold: 5, // Reset timeout after 5 consecutive successes
    });
  }

  /**
   * Create a circuit breaker for production (very conservative)
   */
  static forProduction(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: 3, // 3 failures to open (very sensitive)
      successThreshold: 5, // 5 successes to close (cautious)
      monitoringPeriod: 600000, // 10 minute monitoring window
      timeout: 120000, // 2 minute initial timeout
      maxTimeout: 1800000, // 30 minute maximum timeout
      backoffMultiplier: 3.0, // Triple the timeout (aggressive backoff)
      resetThreshold: 20, // Reset timeout after 20 consecutive successes
    });
  }

  /**
   * Create a custom circuit breaker
   */
  static custom(config: CircuitBreakerConfig): CircuitBreaker {
    return new CircuitBreaker(config);
  }
}
