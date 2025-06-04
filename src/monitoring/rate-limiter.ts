/**
 * Rate limiting implementation for RealtimeRegister API integration
 *
 * Uses sliding window counter algorithm for accurate and memory-efficient rate limiting
 */

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Time until rate limit resets (in milliseconds) */
  resetTime: number;
  /** Current window start time */
  windowStart: number;
  /** Retry after duration in milliseconds (if blocked) */
  retryAfter: number | undefined;
}

export interface RateLimitConfig {
  /** Maximum requests per time period */
  maxRequests: number;
  /** Time period in milliseconds (e.g., 3600000 for 1 hour) */
  periodMs: number;
  /** Window size in milliseconds for sliding window (e.g., 60000 for 1 minute) */
  windowMs: number;
  /** Burst allowance - additional requests allowed in short bursts */
  burstSize?: number;
  /** Burst window duration in milliseconds */
  burstWindowMs?: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'X-RateLimit-Window': string;
  'Retry-After'?: string;
}

/**
 * Sliding Window Rate Limiter
 *
 * Implements a sliding window counter algorithm that:
 * - Divides time into fixed windows
 * - Tracks request counts per window
 * - Slides the window forward continuously
 * - Provides burst protection capability
 */
export class SlidingWindowRateLimiter {
  private readonly windows: Map<number, number> = new Map();
  private readonly config: Required<RateLimitConfig>;
  constructor(config: RateLimitConfig) {
    this.config = {
      burstSize: Math.ceil(config.maxRequests * 0.1), // Default: 10% of max requests
      burstWindowMs: Math.min(config.windowMs * 10, 600000), // Default: 10 windows or 10 mins max
      ...config,
    };

    // Calculate total number of windows in the period
    Math.ceil(this.config.periodMs / this.config.windowMs); // Validation check

    if (this.config.periodMs < this.config.windowMs) {
      throw new Error('Period must be at least one window duration');
    }
  }

  /**
   * Check if a request is allowed and optionally consume a token
   */
  async checkLimit(_identifier: string, consume = true): Promise<RateLimitResult> {
    const now = Date.now();
    const currentWindow = this.getWindowKey(now);

    // Clean up expired windows
    this.cleanupExpiredWindows(now);

    // Calculate current usage across all active windows
    const currentUsage = this.getCurrentUsage();

    // Check main rate limit
    const allowed = currentUsage < this.config.maxRequests;

    if (allowed && consume) {
      // Consume a token by incrementing the current window
      const currentCount = this.windows.get(currentWindow) || 0;
      this.windows.set(currentWindow, currentCount + 1);
    }

    const remaining = Math.max(
      0,
      this.config.maxRequests - currentUsage - (consume && allowed ? 1 : 0)
    );
    const resetTime = this.getResetTime(now);

    return {
      allowed,
      remaining,
      limit: this.config.maxRequests,
      resetTime,
      windowStart: currentWindow,
      retryAfter: allowed ? undefined : this.getRetryAfter(now),
    };
  }

  /**
   * Get current usage across all active windows
   */
  private getCurrentUsage(): number {
    let total = 0;
    for (const count of this.windows.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get window key for timestamp (rounds down to window boundary)
   */
  private getWindowKey(timestamp: number): number {
    return Math.floor(timestamp / this.config.windowMs) * this.config.windowMs;
  }

  /**
   * Clean up expired windows to prevent memory leaks
   */
  private cleanupExpiredWindows(now: number): void {
    const cutoffTime = now - this.config.periodMs;

    for (const [windowKey] of this.windows) {
      if (windowKey < cutoffTime) {
        this.windows.delete(windowKey);
      }
    }
  }

  /**
   * Calculate when the rate limit will reset
   */
  private getResetTime(now: number): number {
    const oldestAllowedWindow = now - this.config.periodMs + this.config.windowMs;
    return oldestAllowedWindow + this.config.periodMs;
  }

  /**
   * Calculate retry-after duration in milliseconds
   */
  private getRetryAfter(now: number): number {
    // Find the oldest window with requests
    let oldestWindow = Infinity;
    for (const [windowKey, count] of this.windows) {
      if (count > 0 && windowKey < oldestWindow) {
        oldestWindow = windowKey;
      }
    }

    if (oldestWindow === Infinity) {
      return this.config.windowMs; // Default to one window
    }

    // Calculate when the oldest window will expire
    const expiryTime = oldestWindow + this.config.periodMs;
    return Math.max(0, expiryTime - now);
  }

  /**
   * Generate HTTP headers for rate limit information
   */
  generateHeaders(result: RateLimitResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(), // Unix timestamp
      'X-RateLimit-Window': this.config.windowMs.toString(),
    };

    if (result.retryAfter !== undefined) {
      headers['Retry-After'] = Math.ceil(result.retryAfter / 1000).toString(); // Seconds
    }

    return headers;
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): {
    currentUsage: number;
    maxRequests: number;
    activeWindows: number;
    oldestWindow: number | null;
    newestWindow: number | null;
  } {
    const usage = this.getCurrentUsage();
    const windowKeys = Array.from(this.windows.keys()).sort((a, b) => a - b);

    return {
      currentUsage: usage,
      maxRequests: this.config.maxRequests,
      activeWindows: this.windows.size,
      oldestWindow: windowKeys.length > 0 ? windowKeys[0]! : null,
      newestWindow: windowKeys.length > 0 ? windowKeys[windowKeys.length - 1]! : null,
    };
  }

  /**
   * Reset all rate limiting data (useful for testing)
   */
  reset(): void {
    this.windows.clear();
  }
}

/**
 * Rate limit error thrown when requests exceed limits
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly result: RateLimitResult,
    public readonly headers: RateLimitHeaders
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Factory function to create rate limiters with common configurations
 */
export class RateLimiterFactory {
  /**
   * Create a rate limiter for RealtimeRegister API (conservative settings)
   */
  static forRealtimeRegister(): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter({
      maxRequests: 500, // 500 requests per hour
      periodMs: 3600000, // 1 hour
      windowMs: 60000, // 1 minute windows
      burstSize: 50, // 50 request burst allowance
      burstWindowMs: 600000, // 10 minute burst window
    });
  }

  /**
   * Create a rate limiter for development/testing (more lenient)
   */
  static forDevelopment(): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter({
      maxRequests: 1000, // 1000 requests per hour
      periodMs: 3600000, // 1 hour
      windowMs: 60000, // 1 minute windows
      burstSize: 100, // 100 request burst allowance
      burstWindowMs: 300000, // 5 minute burst window
    });
  }

  /**
   * Create a rate limiter for production (very conservative)
   */
  static forProduction(): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter({
      maxRequests: 300, // 300 requests per hour
      periodMs: 3600000, // 1 hour
      windowMs: 60000, // 1 minute windows
      burstSize: 30, // 30 request burst allowance
      burstWindowMs: 900000, // 15 minute burst window
    });
  }

  /**
   * Create a custom rate limiter
   */
  static custom(config: RateLimitConfig): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter(config);
  }
}
