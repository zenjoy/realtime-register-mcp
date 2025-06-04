/**
 * Monitoring and alerting system for RealtimeRegister API integration
 *
 * Provides comprehensive monitoring for rate limits, circuit breakers, and API health
 * with configurable alerting and event emission capabilities
 */

import { EventEmitter } from 'events';
import { RateLimitResult } from './rate-limiter.js';
import { CircuitBreakerMetrics, CircuitBreakerState } from './circuit-breaker.js';

export enum MonitoringEventType {
  RATE_LIMIT_WARNING = 'rate_limit_warning',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  CIRCUIT_BREAKER_OPENED = 'circuit_breaker_opened',
  CIRCUIT_BREAKER_CLOSED = 'circuit_breaker_closed',
  CIRCUIT_BREAKER_HALF_OPEN = 'circuit_breaker_half_open',
  API_ERROR = 'api_error',
  PERFORMANCE_WARNING = 'performance_warning',
  HEALTH_CHECK_FAILED = 'health_check_failed',
  METRICS_SUMMARY = 'metrics_summary',
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface MonitoringAlert {
  id: string;
  timestamp: number;
  type: MonitoringEventType;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  source: 'rate_limiter' | 'circuit_breaker' | 'api_client' | 'health_check';
  resolved?: boolean;
  resolvedAt?: number;
}

export interface MonitoringConfig {
  /** Enable/disable monitoring */
  enabled: boolean;
  /** Rate limit warning threshold (percentage) */
  rateLimitWarningThreshold: number;
  /** Circuit breaker failure rate warning threshold (percentage) */
  circuitBreakerFailureThreshold: number;
  /** API response time warning threshold (milliseconds) */
  responseTimeThreshold: number;
  /** Enable console logging */
  enableConsoleLogging: boolean;
  /** Enable event emission */
  enableEventEmission: boolean;
  /** Maximum number of alerts to store in memory */
  maxStoredAlerts: number;
  /** Alert aggregation window (milliseconds) */
  alertAggregationWindow: number;
  /** Metrics collection interval (milliseconds) */
  metricsInterval: number;
}

export interface ApiMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastRequestTime: number | null;
  lastErrorTime: number | null;
  errorRate: number;
  requestsPerMinute: number;
}

export interface HealthStatus {
  isHealthy: boolean;
  rateLimiterStatus: 'healthy' | 'warning' | 'critical';
  circuitBreakerStatus: 'healthy' | 'warning' | 'critical';
  apiStatus: 'healthy' | 'warning' | 'critical';
  lastChecked: number;
  uptime: number;
  issues: string[];
}

/**
 * Comprehensive monitoring system for API integration
 */
export class ApiMonitor extends EventEmitter {
  private readonly config: MonitoringConfig;
  private alerts: MonitoringAlert[] = [];
  private apiMetrics: ApiMetrics;
  private startTime: number = Date.now();
  // private lastRateLimitAlert: number | null = null; // For alert throttling
  // private lastCircuitBreakerAlert: number | null = null; // For alert throttling
  private metricsTimer: NodeJS.Timeout | null = null;
  private requestTimes: number[] = []; // Rolling window of response times

  constructor(config: Partial<MonitoringConfig> = {}) {
    super();

    this.config = {
      enabled: true,
      rateLimitWarningThreshold: 80, // 80% of limit
      circuitBreakerFailureThreshold: 50, // 50% failure rate
      responseTimeThreshold: 5000, // 5 seconds
      enableConsoleLogging: true,
      enableEventEmission: true,
      maxStoredAlerts: 1000,
      alertAggregationWindow: 60000, // 1 minute
      metricsInterval: 30000, // 30 seconds
      ...config,
    };

    this.apiMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastRequestTime: null,
      lastErrorTime: null,
      errorRate: 0,
      requestsPerMinute: 0,
    };

    if (this.config.enabled && this.config.metricsInterval > 0) {
      this.startMetricsCollection();
    }
  }

  /**
   * Monitor rate limit status
   */
  monitorRateLimit(identifier: string, result: RateLimitResult): void {
    if (!this.config.enabled) return;

    const usagePercentage = ((result.limit - result.remaining) / result.limit) * 100;

    // Warning threshold check
    if (usagePercentage >= this.config.rateLimitWarningThreshold) {
      this.createAlert({
        type: MonitoringEventType.RATE_LIMIT_WARNING,
        severity: AlertSeverity.WARNING,
        message: `Rate limit usage at ${usagePercentage.toFixed(1)}% for ${identifier}`,
        details: { identifier, usagePercentage, ...result },
        source: 'rate_limiter',
      });
    }

    // Rate limit exceeded
    if (!result.allowed) {
      this.createAlert({
        type: MonitoringEventType.RATE_LIMIT_EXCEEDED,
        severity: AlertSeverity.ERROR,
        message: `Rate limit exceeded for ${identifier}`,
        details: {
          identifier,
          allowed: result.allowed,
          remaining: result.remaining,
          limit: result.limit,
          resetTime: result.resetTime,
          windowStart: result.windowStart,
          retryAfter: result.retryAfter,
        },
        source: 'rate_limiter',
      });
    }
  }

  /**
   * Monitor circuit breaker status
   */
  monitorCircuitBreaker(identifier: string, metrics: CircuitBreakerMetrics): void {
    if (!this.config.enabled) return;

    const currentState = metrics.state;
    const failureRate =
      metrics.totalRequests > 0 ? (metrics.totalFailures / metrics.totalRequests) * 100 : 0;

    // State change monitoring
    if (currentState === CircuitBreakerState.OPEN) {
      if (!this.isRecentAlert(MonitoringEventType.CIRCUIT_BREAKER_OPENED)) {
        this.createAlert({
          type: MonitoringEventType.CIRCUIT_BREAKER_OPENED,
          severity: AlertSeverity.CRITICAL,
          message: `Circuit breaker opened for ${identifier}`,
          details: {
            identifier,
            failureRate,
            state: metrics.state,
            totalRequests: metrics.totalRequests,
            totalFailures: metrics.totalFailures,
            totalSuccesses: metrics.totalSuccesses,
            consecutiveFailures: metrics.consecutiveFailures,
            consecutiveSuccesses: metrics.consecutiveSuccesses,
            currentFailures: metrics.currentFailures,
            currentTimeout: metrics.currentTimeout,
            lastFailureTime: metrics.lastFailureTime,
            lastSuccessTime: metrics.lastSuccessTime,
            stateChangedAt: metrics.stateChangedAt,
            timeUntilRetry: metrics.timeUntilRetry,
          },
          source: 'circuit_breaker',
        });
      }
    } else if (currentState === CircuitBreakerState.HALF_OPEN) {
      this.createAlert({
        type: MonitoringEventType.CIRCUIT_BREAKER_HALF_OPEN,
        severity: AlertSeverity.WARNING,
        message: `Circuit breaker in half-open state for ${identifier}`,
        details: { identifier, ...metrics },
        source: 'circuit_breaker',
      });
    } else if (currentState === CircuitBreakerState.CLOSED) {
      // Check if we're recovering from an open state
      const openAlerts = this.alerts.filter(
        (a) =>
          a.type === MonitoringEventType.CIRCUIT_BREAKER_OPENED &&
          !a.resolved &&
          a.details.identifier === identifier
      );

      if (openAlerts.length > 0) {
        this.createAlert({
          type: MonitoringEventType.CIRCUIT_BREAKER_CLOSED,
          severity: AlertSeverity.INFO,
          message: `Circuit breaker recovered for ${identifier}`,
          details: { identifier, ...metrics },
          source: 'circuit_breaker',
        });

        // Mark open alerts as resolved
        openAlerts.forEach((alert) => {
          alert.resolved = true;
          alert.resolvedAt = Date.now();
        });
      }
    }

    // High failure rate warning
    if (failureRate >= this.config.circuitBreakerFailureThreshold && metrics.totalRequests >= 10) {
      if (!this.isRecentAlert(MonitoringEventType.PERFORMANCE_WARNING)) {
        this.createAlert({
          type: MonitoringEventType.PERFORMANCE_WARNING,
          severity: AlertSeverity.WARNING,
          message: `High failure rate detected for ${identifier}: ${failureRate.toFixed(1)}%`,
          details: { identifier, failureRate, ...metrics },
          source: 'circuit_breaker',
        });
      }
    }
  }

  /**
   * Monitor API request performance
   */
  monitorApiRequest(duration: number, success: boolean, endpoint?: string): void {
    if (!this.config.enabled) return;

    const now = Date.now();
    this.apiMetrics.totalRequests++;
    this.apiMetrics.lastRequestTime = now;

    if (success) {
      this.apiMetrics.successfulRequests++;
    } else {
      this.apiMetrics.failedRequests++;
      this.apiMetrics.lastErrorTime = now;
    }

    // Track response times in rolling window (last 100 requests)
    this.requestTimes.push(duration);
    if (this.requestTimes.length > 100) {
      this.requestTimes.shift();
    }

    // Update average response time
    this.apiMetrics.averageResponseTime =
      this.requestTimes.reduce((sum, time) => sum + time, 0) / this.requestTimes.length;

    // Update error rate
    this.apiMetrics.errorRate =
      (this.apiMetrics.failedRequests / this.apiMetrics.totalRequests) * 100;

    // Performance warning for slow requests
    if (duration > this.config.responseTimeThreshold) {
      this.createAlert({
        type: MonitoringEventType.PERFORMANCE_WARNING,
        severity: AlertSeverity.WARNING,
        message: `Slow API response detected: ${duration}ms`,
        details: { duration, endpoint, threshold: this.config.responseTimeThreshold },
        source: 'api_client',
      });
    }

    // API error
    if (!success) {
      this.createAlert({
        type: MonitoringEventType.API_ERROR,
        severity: AlertSeverity.ERROR,
        message: `API request failed`,
        details: { duration, endpoint, errorRate: this.apiMetrics.errorRate },
        source: 'api_client',
      });
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    const now = Date.now();
    const uptime = now - this.startTime;
    const issues: string[] = [];

    // Check for recent critical alerts
    const recentCriticalAlerts = this.alerts.filter(
      (alert) =>
        alert.severity === AlertSeverity.CRITICAL &&
        !alert.resolved &&
        now - alert.timestamp < 300000 // Last 5 minutes
    );

    const rateLimiterStatus = this.determineComponentStatus('rate_limiter');
    const circuitBreakerStatus = this.determineComponentStatus('circuit_breaker');
    const apiStatus = this.determineComponentStatus('api_client');

    if (rateLimiterStatus !== 'healthy') {
      issues.push(`Rate limiter: ${rateLimiterStatus}`);
    }
    if (circuitBreakerStatus !== 'healthy') {
      issues.push(`Circuit breaker: ${circuitBreakerStatus}`);
    }
    if (apiStatus !== 'healthy') {
      issues.push(`API: ${apiStatus}`);
    }

    const isHealthy = recentCriticalAlerts.length === 0 && issues.length === 0;

    return {
      isHealthy,
      rateLimiterStatus,
      circuitBreakerStatus,
      apiStatus,
      lastChecked: now,
      uptime,
      issues,
    };
  }

  /**
   * Get current API metrics
   */
  getApiMetrics(): ApiMetrics {
    // Calculate requests per minute
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.alerts.filter(
      (alert) => alert.timestamp > oneMinuteAgo && alert.source === 'api_client'
    ).length;

    this.apiMetrics.requestsPerMinute = recentRequests;

    return { ...this.apiMetrics };
  }

  /**
   * Get alerts with optional filtering
   */
  getAlerts(
    options: {
      severity?: AlertSeverity;
      type?: MonitoringEventType;
      source?: string;
      resolved?: boolean;
      limit?: number;
    } = {}
  ): MonitoringAlert[] {
    let filtered = [...this.alerts];

    if (options.severity) {
      filtered = filtered.filter((alert) => alert.severity === options.severity);
    }
    if (options.type) {
      filtered = filtered.filter((alert) => alert.type === options.type);
    }
    if (options.source) {
      filtered = filtered.filter((alert) => alert.source === options.source);
    }
    if (options.resolved !== undefined) {
      filtered = filtered.filter((alert) => !!alert.resolved === options.resolved);
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Clear old alerts and resolved alerts
   */
  cleanupAlerts(): void {
    const now = Date.now();
    const cutoffTime = now - 24 * 60 * 60 * 1000; // 24 hours ago

    this.alerts = this.alerts.filter((alert) => {
      // Keep unresolved alerts and recent resolved alerts
      return (
        (!alert.resolved || (alert.resolvedAt && alert.resolvedAt > cutoffTime)) &&
        alert.timestamp > cutoffTime
      );
    });

    // Ensure we don't exceed max stored alerts
    if (this.alerts.length > this.config.maxStoredAlerts) {
      this.alerts = this.alerts
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.config.maxStoredAlerts);
    }
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;

    if (enabled && !this.metricsTimer) {
      this.startMetricsCollection();
    } else if (!enabled && this.metricsTimer) {
      this.stopMetricsCollection();
    }
  }

  /**
   * Stop monitoring and cleanup
   */
  stop(): void {
    this.stopMetricsCollection();
    this.removeAllListeners();
  }

  /**
   * Create and process a new alert
   */
  private createAlert(alertData: Omit<MonitoringAlert, 'id' | 'timestamp'>): void {
    if (!this.config.enabled) return;

    const alert: MonitoringAlert = {
      id: this.generateAlertId(),
      timestamp: Date.now(),
      ...alertData,
    };

    this.alerts.push(alert);

    if (this.config.enableConsoleLogging) {
      this.logAlert(alert);
    }

    if (this.config.enableEventEmission) {
      this.emit(alert.type, alert);
      this.emit('alert', alert);
    }

    // Cleanup old alerts periodically
    if (this.alerts.length % 100 === 0) {
      this.cleanupAlerts();
    }
  }

  /**
   * Check if there's a recent alert of the same type
   */
  private isRecentAlert(type: MonitoringEventType): boolean {
    const now = Date.now();
    return this.alerts.some(
      (alert) => alert.type === type && now - alert.timestamp < this.config.alertAggregationWindow
    );
  }

  /**
   * Determine component health status
   */
  private determineComponentStatus(source: string): 'healthy' | 'warning' | 'critical' {
    const now = Date.now();
    const fiveMinutesAgo = now - 300000;

    const recentAlerts = this.alerts.filter(
      (alert) => alert.source === source && alert.timestamp > fiveMinutesAgo && !alert.resolved
    );

    const criticalAlerts = recentAlerts.filter(
      (alert) => alert.severity === AlertSeverity.CRITICAL
    );
    const warningAlerts = recentAlerts.filter((alert) => alert.severity === AlertSeverity.WARNING);

    if (criticalAlerts.length > 0) return 'critical';
    if (warningAlerts.length > 0) return 'warning';
    return 'healthy';
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log alert to console
   */
  private logAlert(alert: MonitoringAlert): void {
    const timestamp = new Date(alert.timestamp).toISOString();
    const prefix = `[${timestamp}] [${alert.severity.toUpperCase()}] [${alert.source}]`;

    switch (alert.severity) {
      case AlertSeverity.CRITICAL:
        console.error(`${prefix} ${alert.message}`, alert.details);
        break;
      case AlertSeverity.ERROR:
        console.error(`${prefix} ${alert.message}`, alert.details);
        break;
      case AlertSeverity.WARNING:
        console.warn(`${prefix} ${alert.message}`, alert.details);
        break;
      default:
        console.log(`${prefix} ${alert.message}`, alert.details);
    }
  }

  /**
   * Start metrics collection timer
   */
  private startMetricsCollection(): void {
    if (this.metricsTimer) return;

    this.metricsTimer = setInterval(() => {
      this.emitMetricsSummary();
      this.cleanupAlerts();
    }, this.config.metricsInterval);
  }

  /**
   * Stop metrics collection timer
   */
  private stopMetricsCollection(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Emit metrics summary
   */
  private emitMetricsSummary(): void {
    const healthStatus = this.getHealthStatus();
    const apiMetrics = this.getApiMetrics();

    const summary = {
      timestamp: Date.now(),
      health: healthStatus,
      api: apiMetrics,
      alerts: {
        total: this.alerts.length,
        unresolved: this.alerts.filter((a) => !a.resolved).length,
        critical: this.alerts.filter((a) => a.severity === AlertSeverity.CRITICAL && !a.resolved)
          .length,
      },
    };

    if (this.config.enableEventEmission) {
      this.emit(MonitoringEventType.METRICS_SUMMARY, summary);
    }
  }
}

/**
 * Factory for creating monitors with common configurations
 */
export class MonitorFactory {
  /**
   * Create a monitor for RealtimeRegister API (production settings)
   */
  static forRealtimeRegister(): ApiMonitor {
    return new ApiMonitor({
      enabled: true,
      rateLimitWarningThreshold: 85, // Conservative warning
      circuitBreakerFailureThreshold: 30, // 30% failure rate warning
      responseTimeThreshold: 10000, // 10 second threshold
      enableConsoleLogging: true,
      enableEventEmission: true,
      maxStoredAlerts: 500,
      alertAggregationWindow: 120000, // 2 minutes
      metricsInterval: 60000, // 1 minute
    });
  }

  /**
   * Create a monitor for development (more verbose)
   */
  static forDevelopment(): ApiMonitor {
    return new ApiMonitor({
      enabled: true,
      rateLimitWarningThreshold: 70, // Earlier warning for testing
      circuitBreakerFailureThreshold: 50, // More lenient failure threshold
      responseTimeThreshold: 5000, // 5 second threshold
      enableConsoleLogging: true,
      enableEventEmission: true,
      maxStoredAlerts: 200,
      alertAggregationWindow: 30000, // 30 seconds
      metricsInterval: 15000, // 15 seconds
    });
  }

  /**
   * Create a custom monitor
   */
  static custom(config: Partial<MonitoringConfig>): ApiMonitor {
    return new ApiMonitor(config);
  }
}
