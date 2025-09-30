import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import {
  ApiMonitor,
  MonitorFactory,
  MonitoringEventType,
  AlertSeverity,
  MonitoringAlert,
} from '../src/monitoring/api-monitor.js';
import { CircuitBreakerState } from '../src/monitoring/circuit-breaker.js';
import { RateLimitResult } from '../src/monitoring/rate-limiter.js';

describe('ApiMonitor', () => {
  let monitor: ApiMonitor;
  let mockNow: number;

  beforeEach(() => {
    // Set a fixed timestamp for testing
    mockNow = 1000000000000; // Jan 9, 2001
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);

    // Create a test monitor with fast intervals for testing
    monitor = new ApiMonitor({
      enabled: true,
      rateLimitWarningThreshold: 80,
      circuitBreakerFailureThreshold: 50,
      responseTimeThreshold: 5000,
      enableConsoleLogging: false, // Disable for tests
      enableEventEmission: true,
      maxStoredAlerts: 100,
      alertAggregationWindow: 10000, // 10 seconds
      metricsInterval: 0, // Disable auto metrics for testing
    });
  });

  afterEach(() => {
    monitor.stop();
    jest.restoreAllMocks();
  });

  describe('Rate Limit Monitoring', () => {
    it('should create warning alert when rate limit usage exceeds threshold', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.RATE_LIMIT_WARNING, mockEventListener);

      const rateLimitResult: RateLimitResult = {
        allowed: true,
        remaining: 10,
        limit: 100,
        resetTime: mockNow + 60000,
        windowStart: mockNow,
        retryAfter: 0,
      };

      monitor.monitorRateLimit('test-client', rateLimitResult);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.RATE_LIMIT_WARNING);
      expect(alert.severity).toBe(AlertSeverity.WARNING);
      expect(alert.source).toBe('rate_limiter');
      expect(alert.details.identifier).toBe('test-client');
    });

    it('should create error alert when rate limit is exceeded', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.RATE_LIMIT_EXCEEDED, mockEventListener);

      const rateLimitResult: RateLimitResult = {
        allowed: false,
        remaining: 0,
        limit: 100,
        resetTime: mockNow + 60000,
        windowStart: mockNow,
        retryAfter: 30000,
      };

      monitor.monitorRateLimit('test-client', rateLimitResult);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.RATE_LIMIT_EXCEEDED);
      expect(alert.severity).toBe(AlertSeverity.ERROR);
      expect(alert.details.retryAfter).toBe(30000);
    });

    it('should not create alerts when monitoring is disabled', () => {
      monitor.setEnabled(false);
      const mockEventListener = jest.fn();
      monitor.on('alert', mockEventListener);

      const rateLimitResult: RateLimitResult = {
        allowed: false,
        remaining: 0,
        limit: 100,
        resetTime: mockNow + 60000,
        windowStart: mockNow,
        retryAfter: 30000,
      };

      monitor.monitorRateLimit('test-client', rateLimitResult);

      expect(mockEventListener).not.toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker Monitoring', () => {
    it('should create critical alert when circuit breaker opens', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.CIRCUIT_BREAKER_OPENED, mockEventListener);

      const metrics = {
        state: CircuitBreakerState.OPEN,
        totalRequests: 10,
        totalFailures: 6,
        totalSuccesses: 4,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        currentFailures: 3,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow - 10000,
        stateChangedAt: mockNow,
        timeUntilRetry: 60000,
      };

      monitor.monitorCircuitBreaker('api-client', metrics);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.CIRCUIT_BREAKER_OPENED);
      expect(alert.severity).toBe(AlertSeverity.CRITICAL);
      expect(alert.source).toBe('circuit_breaker');
    });

    it('should create info alert when circuit breaker closes after being open', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.CIRCUIT_BREAKER_CLOSED, mockEventListener);

      // First, create an open state alert
      const openMetrics = {
        state: CircuitBreakerState.OPEN,
        totalRequests: 10,
        totalFailures: 6,
        totalSuccesses: 4,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        currentFailures: 3,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow - 10000,
        stateChangedAt: mockNow,
        timeUntilRetry: 60000,
      };
      monitor.monitorCircuitBreaker('api-client', openMetrics);

      // Then simulate closing
      const closedMetrics = {
        ...openMetrics,
        state: CircuitBreakerState.CLOSED,
        consecutiveFailures: 0,
        stateChangedAt: mockNow + 60000,
        timeUntilRetry: 0,
      };
      monitor.monitorCircuitBreaker('api-client', closedMetrics);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.CIRCUIT_BREAKER_CLOSED);
      expect(alert.severity).toBe(AlertSeverity.INFO);
    });

    it('should create warning alert for high failure rate', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.PERFORMANCE_WARNING, mockEventListener);

      const metrics = {
        state: CircuitBreakerState.CLOSED,
        totalRequests: 20,
        totalFailures: 12, // 60% failure rate
        totalSuccesses: 8,
        consecutiveFailures: 0,
        consecutiveSuccesses: 2,
        currentFailures: 0,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow,
        stateChangedAt: mockNow,
        timeUntilRetry: 0,
      };

      monitor.monitorCircuitBreaker('api-client', metrics);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.PERFORMANCE_WARNING);
      expect(alert.severity).toBe(AlertSeverity.WARNING);
      expect(alert.details.failureRate).toBe(60);
    });
  });

  describe('API Request Monitoring', () => {
    it('should track successful API requests', () => {
      monitor.monitorApiRequest(1000, true, '/api/test');

      const metrics = monitor.getApiMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.averageResponseTime).toBe(1000);
      expect(metrics.errorRate).toBe(0);
    });

    it('should track failed API requests', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.API_ERROR, mockEventListener);

      monitor.monitorApiRequest(2000, false, '/api/test');

      const metrics = monitor.getApiMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(1);
      expect(metrics.errorRate).toBe(100);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.API_ERROR);
      expect(alert.severity).toBe(AlertSeverity.ERROR);
    });

    it('should create performance warning for slow requests', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.PERFORMANCE_WARNING, mockEventListener);

      monitor.monitorApiRequest(6000, true, '/api/slow'); // Above 5000ms threshold

      expect(mockEventListener).toHaveBeenCalledTimes(1);
      const alert = mockEventListener.mock.calls[0]?.[0] as MonitoringAlert;
      expect(alert.type).toBe(MonitoringEventType.PERFORMANCE_WARNING);
      expect(alert.severity).toBe(AlertSeverity.WARNING);
      expect(alert.details.duration).toBe(6000);
    });

    it('should calculate average response time correctly', () => {
      monitor.monitorApiRequest(1000, true);
      monitor.monitorApiRequest(2000, true);
      monitor.monitorApiRequest(3000, true);

      const metrics = monitor.getApiMetrics();
      expect(metrics.averageResponseTime).toBe(2000);
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.successfulRequests).toBe(3);
    });
  });

  describe('Health Status', () => {
    it('should report healthy status when no issues', () => {
      const health = monitor.getHealthStatus();

      expect(health.isHealthy).toBe(true);
      expect(health.rateLimiterStatus).toBe('healthy');
      expect(health.circuitBreakerStatus).toBe('healthy');
      expect(health.apiStatus).toBe('healthy');
      expect(health.issues).toHaveLength(0);
    });

    it('should report unhealthy status when critical alerts exist', () => {
      // Create a critical circuit breaker alert
      const metrics = {
        state: CircuitBreakerState.OPEN,
        totalRequests: 10,
        totalFailures: 6,
        totalSuccesses: 4,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        currentFailures: 3,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow - 10000,
        stateChangedAt: mockNow,
        timeUntilRetry: 60000,
      };
      monitor.monitorCircuitBreaker('api-client', metrics);

      const health = monitor.getHealthStatus();

      expect(health.isHealthy).toBe(false);
      expect(health.circuitBreakerStatus).toBe('critical');
      expect(health.issues.length).toBeGreaterThan(0);
    });

    it('should calculate uptime correctly', () => {
      mockNow += 60000; // Advance time by 1 minute
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      const health = monitor.getHealthStatus();

      expect(health.uptime).toBe(60000);
      expect(health.lastChecked).toBe(mockNow);
    });
  });

  describe('Alert Management', () => {
    it('should filter alerts by severity', () => {
      // Create alerts with different severities
      monitor.monitorApiRequest(6000, true); // Performance warning
      monitor.monitorApiRequest(1000, false); // API error

      const warningAlerts = monitor.getAlerts({ severity: AlertSeverity.WARNING });
      const errorAlerts = monitor.getAlerts({ severity: AlertSeverity.ERROR });

      expect(warningAlerts).toHaveLength(1);
      expect(errorAlerts).toHaveLength(1);
      expect(warningAlerts[0]?.type).toBe(MonitoringEventType.PERFORMANCE_WARNING);
      expect(errorAlerts[0]?.type).toBe(MonitoringEventType.API_ERROR);
    });

    it('should filter alerts by type', () => {
      monitor.monitorApiRequest(6000, true); // Performance warning
      monitor.monitorApiRequest(1000, false); // API error

      const performanceAlerts = monitor.getAlerts({
        type: MonitoringEventType.PERFORMANCE_WARNING,
      });

      expect(performanceAlerts).toHaveLength(1);
      expect(performanceAlerts[0]?.type).toBe(MonitoringEventType.PERFORMANCE_WARNING);
    });

    it('should limit number of returned alerts', () => {
      // Create multiple alerts
      for (let i = 0; i < 5; i++) {
        monitor.monitorApiRequest(1000, false);
      }

      const limitedAlerts = monitor.getAlerts({ limit: 3 });
      expect(limitedAlerts).toHaveLength(3);
    });

    it('should cleanup old alerts', () => {
      // Create an alert
      monitor.monitorApiRequest(1000, false);
      expect(monitor.getAlerts()).toHaveLength(1);

      // Advance time by more than 24 hours
      mockNow += 25 * 60 * 60 * 1000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      monitor.cleanupAlerts();
      expect(monitor.getAlerts()).toHaveLength(0);
    });
  });

  describe('Alert Aggregation', () => {
    it('should prevent duplicate alerts within aggregation window', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.CIRCUIT_BREAKER_OPENED, mockEventListener);

      const metrics = {
        state: CircuitBreakerState.OPEN,
        totalRequests: 10,
        totalFailures: 6,
        totalSuccesses: 4,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        currentFailures: 3,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow - 10000,
        stateChangedAt: mockNow,
        timeUntilRetry: 60000,
      };

      // Create multiple circuit breaker opened alerts quickly
      monitor.monitorCircuitBreaker('api-client', metrics);
      monitor.monitorCircuitBreaker('api-client', metrics);
      monitor.monitorCircuitBreaker('api-client', metrics);

      // Should only create one alert due to aggregation
      expect(mockEventListener).toHaveBeenCalledTimes(1);
    });

    it('should allow alerts after aggregation window', () => {
      const mockEventListener = jest.fn();
      monitor.on(MonitoringEventType.CIRCUIT_BREAKER_OPENED, mockEventListener);

      const metrics = {
        state: CircuitBreakerState.OPEN,
        totalRequests: 10,
        totalFailures: 6,
        totalSuccesses: 4,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        currentFailures: 3,
        currentTimeout: 60000,
        lastFailureTime: mockNow,
        lastSuccessTime: mockNow - 10000,
        stateChangedAt: mockNow,
        timeUntilRetry: 60000,
      };

      monitor.monitorCircuitBreaker('api-client', metrics);

      // Advance time beyond aggregation window
      mockNow += 15000; // 15 seconds > 10 second aggregation window
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      monitor.monitorCircuitBreaker('api-client', metrics);

      expect(mockEventListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('Enable/Disable Monitoring', () => {
    it('should disable monitoring when setEnabled(false)', () => {
      monitor.setEnabled(false);
      const mockEventListener = jest.fn();
      monitor.on('alert', mockEventListener);

      monitor.monitorApiRequest(1000, false);

      expect(mockEventListener).not.toHaveBeenCalled();
    });

    it('should re-enable monitoring when setEnabled(true)', () => {
      monitor.setEnabled(false);
      monitor.setEnabled(true);

      const mockEventListener = jest.fn();
      monitor.on('alert', mockEventListener);

      monitor.monitorApiRequest(1000, false);

      expect(mockEventListener).toHaveBeenCalledTimes(1);
    });
  });
});

describe('MonitorFactory', () => {
  afterEach(() => {
    // Clean up any created monitors
    jest.resetAllMocks();
  });

  it('should create RealtimeRegister monitor with correct config', () => {
    const monitor = MonitorFactory.forRealtimeRegister();

    expect(monitor).toBeInstanceOf(ApiMonitor);
    // Test that it's properly configured by triggering an event
    const mockEventListener = jest.fn();
    monitor.on('alert', mockEventListener);

    monitor.monitorApiRequest(1000, false);
    expect(mockEventListener).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it('should create development monitor with correct config', () => {
    const monitor = MonitorFactory.forDevelopment();

    expect(monitor).toBeInstanceOf(ApiMonitor);

    const mockEventListener = jest.fn();
    monitor.on('alert', mockEventListener);

    monitor.monitorApiRequest(1000, false);
    expect(mockEventListener).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it('should create custom monitor with provided config', () => {
    const customConfig = {
      enabled: true,
      rateLimitWarningThreshold: 90,
      enableConsoleLogging: false,
    };

    const monitor = MonitorFactory.custom(customConfig);

    expect(monitor).toBeInstanceOf(ApiMonitor);

    monitor.stop();
  });
});
