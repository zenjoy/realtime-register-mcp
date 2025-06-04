import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import {
  CircuitBreaker,
  CircuitBreakerFactory,
  CircuitBreakerOpenError,
  CircuitBreakerState,
  CircuitBreakerConfig,
} from '../src/monitoring/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockNow: number;

  beforeEach(() => {
    // Set a fixed timestamp for testing
    mockNow = 1000000000000; // Jan 9, 2001
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);

    // Create a test circuit breaker with small thresholds for easier testing
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      monitoringPeriod: 60000, // 1 minute
      timeout: 10000, // 10 seconds
      maxTimeout: 60000, // 1 minute
      backoffMultiplier: 2.0,
      resetThreshold: 5,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should throw error for invalid failure threshold', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 0,
            successThreshold: 2,
            monitoringPeriod: 60000,
            timeout: 10000,
            maxTimeout: 60000,
            backoffMultiplier: 2.0,
            resetThreshold: 5,
          })
      ).toThrow('Failure threshold must be greater than 0');
    });

    it('should throw error for invalid success threshold', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 0,
            monitoringPeriod: 60000,
            timeout: 10000,
            maxTimeout: 60000,
            backoffMultiplier: 2.0,
            resetThreshold: 5,
          })
      ).toThrow('Success threshold must be greater than 0');
    });

    it('should throw error for invalid monitoring period', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            monitoringPeriod: 0,
            timeout: 10000,
            maxTimeout: 60000,
            backoffMultiplier: 2.0,
            resetThreshold: 5,
          })
      ).toThrow('Monitoring period must be greater than 0');
    });

    it('should throw error for invalid timeout', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            monitoringPeriod: 60000,
            timeout: 0,
            maxTimeout: 60000,
            backoffMultiplier: 2.0,
            resetThreshold: 5,
          })
      ).toThrow('Timeout must be greater than 0');
    });

    it('should throw error for maxTimeout less than timeout', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            monitoringPeriod: 60000,
            timeout: 60000,
            maxTimeout: 30000,
            backoffMultiplier: 2.0,
            resetThreshold: 5,
          })
      ).toThrow('Max timeout must be greater than or equal to initial timeout');
    });

    it('should throw error for invalid backoff multiplier', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            monitoringPeriod: 60000,
            timeout: 10000,
            maxTimeout: 60000,
            backoffMultiplier: 1.0,
            resetThreshold: 5,
          })
      ).toThrow('Backoff multiplier must be greater than 1');
    });

    it('should throw error for invalid reset threshold', () => {
      expect(
        () =>
          new CircuitBreaker({
            failureThreshold: 3,
            successThreshold: 2,
            monitoringPeriod: 60000,
            timeout: 10000,
            maxTimeout: 60000,
            backoffMultiplier: 2.0,
            resetThreshold: 0,
          })
      ).toThrow('Reset threshold must be greater than 0');
    });
  });

  describe('CLOSED State', () => {
    it('should allow requests when circuit is closed', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(mockOperation);

      expect(result.allowed).toBe(true);
      expect(result.result).toBe('success');
      expect(result.state).toBe(CircuitBreakerState.CLOSED);
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should track successful operations', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalSuccesses).toBe(2);
      expect(metrics.totalFailures).toBe(0);
    });

    it('should transition to OPEN after reaching failure threshold', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));

      // Trigger 3 failures (our threshold)
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should handle mixed success and failure scenarios', async () => {
      const successOp = jest.fn().mockResolvedValue('success');
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      // 2 failures, 1 success, 2 more failures = should open
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(successOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('OPEN State', () => {
    beforeEach(async () => {
      // Force circuit breaker to OPEN state
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should block requests when circuit is open', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(mockOperation);

      expect(result.allowed).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.state).toBe(CircuitBreakerState.OPEN);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should provide retry-after time', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(mockOperation);

      expect(result.retryAfter).toBeLessThanOrEqual(20000); // 2x initial timeout
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      // Move time forward by timeout period
      mockNow += 20000; // 20 seconds (2x initial timeout due to backoff)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      const result = await circuitBreaker.execute(mockOperation);

      expect(result.allowed).toBe(true);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should apply exponential backoff on consecutive open states', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));

      // Get initial timeout (should be 20000ms = 2x initial 10000ms)
      const metrics1 = circuitBreaker.getMetrics();
      expect(metrics1.currentTimeout).toBe(20000);

      // Move time to trigger half-open and fail again
      mockNow += 20000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      await circuitBreaker.execute(mockOperation); // This should fail and trigger another open

      // Timeout should be doubled again
      const metrics2 = circuitBreaker.getMetrics();
      expect(metrics2.currentTimeout).toBe(40000);
    });

    it('should cap timeout at maxTimeout', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));

      // Force multiple failures to test max timeout cap
      for (let i = 0; i < 10; i++) {
        // Move time to allow transition to half-open
        mockNow += circuitBreaker.getMetrics().currentTimeout;
        jest.spyOn(Date, 'now').mockReturnValue(mockNow);

        await circuitBreaker.execute(mockOperation);
      }

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.currentTimeout).toBeLessThanOrEqual(60000); // maxTimeout
    });
  });

  describe('HALF_OPEN State', () => {
    beforeEach(async () => {
      // Force circuit breaker to OPEN state, then transition to HALF_OPEN
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);

      // Move time forward to trigger half-open
      mockNow += 20000; // 2x initial timeout
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      // Make one request to transition to half-open
      await circuitBreaker.execute(jest.fn().mockResolvedValue('success'));
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should allow limited requests in half-open state', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      // Should allow requests up to successThreshold (2)
      const result1 = await circuitBreaker.execute(mockOperation);
      expect(result1.allowed).toBe(true);

      // After 2 successful requests (1 from beforeEach + 1 above), should be closed
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition to CLOSED after success threshold is met', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      // One more success should close it (already had 1 in beforeEach)
      await circuitBreaker.execute(mockOperation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition back to OPEN on any failure', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('failure'));

      await circuitBreaker.execute(mockOperation);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should block requests after success threshold is reached', async () => {
      // Reset and manually set to half-open with success count at threshold
      circuitBreaker.reset();
      circuitBreaker.forceState(CircuitBreakerState.HALF_OPEN);

      const mockOperation = jest.fn().mockResolvedValue('success');

      // Fill up the success threshold
      await circuitBreaker.execute(mockOperation);
      await circuitBreaker.execute(mockOperation);

      // Should now be closed
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should provide comprehensive metrics', async () => {
      const successOp = jest.fn().mockResolvedValue('success');
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      await circuitBreaker.execute(successOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(successOp);

      const metrics = circuitBreaker.getMetrics();

      expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.totalSuccesses).toBe(2);
      expect(metrics.totalFailures).toBe(1);
      expect(metrics.consecutiveSuccesses).toBe(1);
      expect(metrics.lastSuccessTime).toBe(mockNow);
      expect(metrics.lastFailureTime).toBe(mockNow);
    });

    it('should track consecutive failures correctly', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(3);
      expect(metrics.state).toBe(CircuitBreakerState.OPEN);
    });

    it('should calculate time until retry correctly', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      // Trigger open state
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.timeUntilRetry).toBe(20000); // 2x initial timeout

      // Move time forward
      mockNow += 5000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      const metrics2 = circuitBreaker.getMetrics();
      expect(metrics2.timeUntilRetry).toBe(15000); // 20000 - 5000
    });
  });

  describe('Failure Window Management', () => {
    it('should clean up old failures outside monitoring period', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      // Add 2 failures
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      // Move time forward beyond monitoring period
      mockNow += 70000; // 70 seconds > 60 second monitoring period
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      // Add another failure - should not trigger open state as old failures are cleaned up
      await circuitBreaker.execute(failureOp);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.currentFailures).toBe(1); // Only the recent failure
    });

    it('should maintain failures within monitoring period', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      // Add 2 failures
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      // Move time forward but stay within monitoring period
      mockNow += 30000; // 30 seconds < 60 second monitoring period
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      // Add another failure - should trigger open state
      await circuitBreaker.execute(failureOp);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Utility Methods', () => {
    it('should reset circuit breaker to initial state', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));

      // Trigger some activity
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalFailures).toBe(0);
      expect(metrics.totalSuccesses).toBe(0);
    });

    it('should force state transition', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);

      circuitBreaker.forceState(CircuitBreakerState.OPEN);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.forceState(CircuitBreakerState.HALF_OPEN);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });
  });

  describe('Success Reset Behavior', () => {
    it('should reset timeout after consecutive successes', async () => {
      const failureOp = jest.fn().mockRejectedValue(new Error('failure'));
      const successOp = jest.fn().mockResolvedValue('success');

      // Trigger open state
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);
      await circuitBreaker.execute(failureOp);

      const metrics1 = circuitBreaker.getMetrics();
      expect(metrics1.currentTimeout).toBe(20000); // 2x initial

      // Transition back to closed via half-open
      mockNow += 20000;
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      await circuitBreaker.execute(successOp); // Half-open
      await circuitBreaker.execute(successOp); // Closed

      // Add enough consecutive successes to trigger timeout reset
      for (let i = 0; i < 5; i++) {
        // resetThreshold is 5
        await circuitBreaker.execute(successOp);
      }

      const metrics2 = circuitBreaker.getMetrics();
      expect(metrics2.currentTimeout).toBe(10000); // Back to initial
    });
  });
});

describe('CircuitBreakerFactory', () => {
  it('should create RealtimeRegister circuit breaker with correct config', () => {
    const cb = CircuitBreakerFactory.forRealtimeRegister();
    const metrics = cb.getMetrics();

    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(metrics.currentTimeout).toBe(60000); // 1 minute
  });

  it('should create development circuit breaker with lenient config', () => {
    const cb = CircuitBreakerFactory.forDevelopment();
    const metrics = cb.getMetrics();

    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(metrics.currentTimeout).toBe(30000); // 30 seconds
  });

  it('should create production circuit breaker with conservative config', () => {
    const cb = CircuitBreakerFactory.forProduction();
    const metrics = cb.getMetrics();

    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(metrics.currentTimeout).toBe(120000); // 2 minutes
  });

  it('should create custom circuit breaker', () => {
    const config: CircuitBreakerConfig = {
      failureThreshold: 1,
      successThreshold: 1,
      monitoringPeriod: 30000,
      timeout: 5000,
      maxTimeout: 30000,
      backoffMultiplier: 1.5,
      resetThreshold: 3,
    };

    const cb = CircuitBreakerFactory.custom(config);
    const metrics = cb.getMetrics();

    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(metrics.currentTimeout).toBe(5000);
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should create error with correct properties', () => {
    const mockMetrics = {
      state: CircuitBreakerState.OPEN,
      totalRequests: 10,
      totalFailures: 5,
      totalSuccesses: 5,
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      currentTimeout: 20000,
      lastFailureTime: Date.now(),
      lastSuccessTime: Date.now() - 1000,
      stateChangedAt: Date.now() - 5000,
      timeUntilRetry: 15000,
    };

    const error = new CircuitBreakerOpenError('Circuit breaker is open', mockMetrics, 15000);

    expect(error.name).toBe('CircuitBreakerOpenError');
    expect(error.message).toBe('Circuit breaker is open');
    expect(error.metrics).toBe(mockMetrics);
    expect(error.retryAfter).toBe(15000);
  });
});
