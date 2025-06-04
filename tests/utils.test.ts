import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  Result,
  success,
  failure,
  safe,
  safeAsync,
  debounce,
  throttle,
  retry,
  timeout,
  pipe,
  compose,
  isNotNullish,
  isDefined,
  isNonEmptyString,
  isPositiveNumber,
} from '../src/core/utils.js';

describe('Utils', () => {
  describe('Result type helpers', () => {
    it('should create successful result', () => {
      const result = success('test data');
      expect(result.success).toBe(true);
      expect(result.data).toBe('test data');
    });

    it('should create failed result', () => {
      const error = new Error('test error');
      const result = failure(error);
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('safe function wrapper', () => {
    it('should return success for successful function', () => {
      const fn = () => 'success';
      const result = safe(fn);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('success');
      }
    });

    it('should return failure for throwing function', () => {
      const fn = () => {
        throw new Error('test error');
      };
      const result = safe(fn);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('test error');
      }
    });

    it('should handle non-Error throws', () => {
      const fn = () => {
        throw 'string error';
      };
      const result = safe(fn);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('string error');
      }
    });
  });

  describe('safeAsync function wrapper', () => {
    it('should return success for successful async function', async () => {
      const fn = async () => 'async success';
      const result = await safeAsync(fn);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('async success');
      }
    });

    it('should return failure for rejecting async function', async () => {
      const fn = async () => {
        throw new Error('async error');
      };
      const result = await safeAsync(fn);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('async error');
      }
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should debounce function calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn('call1');
      debouncedFn('call2');
      debouncedFn('call3');

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call3');
    });

    it('should reset timer on subsequent calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn('call1');
      jest.advanceTimersByTime(50);
      debouncedFn('call2');
      jest.advanceTimersByTime(50);

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call2');
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should throttle function calls', () => {
      const fn = jest.fn();
      const throttledFn = throttle(fn, 100);

      throttledFn('call1');
      throttledFn('call2');
      throttledFn('call3');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call1');

      jest.advanceTimersByTime(100);
      throttledFn('call4');

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('call4');
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('attempt 1'))
        .mockRejectedValueOnce(new Error('attempt 2'))
        .mockResolvedValue('success');

      const result = await retry(fn, { attempts: 3, delay: 0 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));

      await expect(retry(fn, { attempts: 2, delay: 0 })).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect shouldRetry predicate', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('should not retry'));
      const shouldRetry = jest.fn().mockReturnValue(false);

      await expect(retry(fn, { attempts: 3, shouldRetry, delay: 0 })).rejects.toThrow('should not retry');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('timeout', () => {
    it('should resolve if promise completes within timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await timeout(promise, 100);

      expect(result).toBe('success');
    });

    it('should reject if promise exceeds timeout', async () => {
      const promise = new Promise(resolve => setTimeout(() => resolve('late'), 200));
      
      await expect(timeout(promise, 100)).rejects.toThrow('Operation timed out');
    });

    it('should use custom timeout message', async () => {
      const promise = new Promise(resolve => setTimeout(() => resolve('late'), 200));
      
      await expect(timeout(promise, 100, 'Custom timeout')).rejects.toThrow('Custom timeout');
    });
  });

  describe('pipe', () => {
    it('should pipe functions left to right', () => {
      const add1 = (x: number) => x + 1;
      const multiply2 = (x: number) => x * 2;
      const subtract3 = (x: number) => x - 3;

      const piped = pipe(add1, multiply2, subtract3);
      const result = piped(5);

      // ((5 + 1) * 2) - 3 = 9
      expect(result).toBe(9);
    });
  });

  describe('compose', () => {
    it('should compose functions right to left', () => {
      const add1 = (x: number) => x + 1;
      const multiply2 = (x: number) => x * 2;
      const subtract3 = (x: number) => x - 3;

      const composed = compose(subtract3, multiply2, add1);
      const result = composed(5);

      // ((5 + 1) * 2) - 3 = 9
      expect(result).toBe(9);
    });
  });

  describe('type guards', () => {
    describe('isNotNullish', () => {
      it('should return true for defined values', () => {
        expect(isNotNullish('string')).toBe(true);
        expect(isNotNullish(0)).toBe(true);
        expect(isNotNullish(false)).toBe(true);
        expect(isNotNullish({})).toBe(true);
      });

      it('should return false for null or undefined', () => {
        expect(isNotNullish(null)).toBe(false);
        expect(isNotNullish(undefined)).toBe(false);
      });
    });

    describe('isDefined', () => {
      it('should return true for defined values including null', () => {
        expect(isDefined('string')).toBe(true);
        expect(isDefined(0)).toBe(true);
        expect(isDefined(null)).toBe(true);
      });

      it('should return false for undefined', () => {
        expect(isDefined(undefined)).toBe(false);
      });
    });

    describe('isNonEmptyString', () => {
      it('should return true for non-empty strings', () => {
        expect(isNonEmptyString('hello')).toBe(true);
        expect(isNonEmptyString(' ')).toBe(true);
      });

      it('should return false for empty strings or non-strings', () => {
        expect(isNonEmptyString('')).toBe(false);
        expect(isNonEmptyString(123)).toBe(false);
        expect(isNonEmptyString(null)).toBe(false);
        expect(isNonEmptyString(undefined)).toBe(false);
      });
    });

    describe('isPositiveNumber', () => {
      it('should return true for positive numbers', () => {
        expect(isPositiveNumber(1)).toBe(true);
        expect(isPositiveNumber(3.14)).toBe(true);
        expect(isPositiveNumber(Infinity)).toBe(true);
      });

      it('should return false for non-positive numbers or non-numbers', () => {
        expect(isPositiveNumber(0)).toBe(false);
        expect(isPositiveNumber(-1)).toBe(false);
        expect(isPositiveNumber(NaN)).toBe(false);
        expect(isPositiveNumber('5')).toBe(false);
        expect(isPositiveNumber(null)).toBe(false);
      });
    });
  });
});