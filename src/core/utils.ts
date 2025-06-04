/**
 * Utility functions for common operations
 * Using functional programming approach
 */

/**
 * Type-safe result type for operations that can fail
 */
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Creates a successful result
 */
export const success = <T>(data: T): Result<T> => ({
  success: true,
  data,
});

/**
 * Creates a failed result
 */
export const failure = <E = Error>(error: E): Result<never, E> => ({
  success: false,
  error,
});

/**
 * Safe async function wrapper that returns Result
 */
export const safeAsync = async <T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> => {
  try {
    const data = await fn();
    return success(data);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Safe function wrapper that returns Result
 */
export const safe = <T>(fn: () => T): Result<T, Error> => {
  try {
    const data = fn();
    return success(data);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
};

/**
 * Debounce function utility
 */
export const debounce = <T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number
): ((...args: T) => void) => {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: T) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

/**
 * Throttle function utility
 */
export const throttle = <T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number
): ((...args: T) => void) => {
  let lastCall = 0;
  
  return (...args: T) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
};

/**
 * Retry function with exponential backoff
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    delay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> => {
  const {
    attempts = 3,
    delay = 1000,
    backoffFactor = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === attempts || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      const currentDelay = delay * Math.pow(backoffFactor, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
  
  throw lastError!;
};

/**
 * Creates a timeout promise that rejects after specified time
 */
export const timeout = <T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out'
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
};

/**
 * Functional pipe utility for composing functions
 */
export const pipe = <T>(...fns: Array<(arg: T) => T>) => (value: T): T =>
  fns.reduce((acc, fn) => fn(acc), value);

/**
 * Functional compose utility for composing functions (right to left)
 */
export const compose = <T>(...fns: Array<(arg: T) => T>) => (value: T): T =>
  fns.reduceRight((acc, fn) => fn(acc), value);

/**
 * Curried function to check if value is not null or undefined
 */
export const isNotNullish = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/**
 * Type guard for checking if value is defined
 */
export const isDefined = <T>(value: T | undefined): value is T =>
  value !== undefined;

/**
 * Type guard for checking if value is a non-empty string
 */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Type guard for checking if value is a positive number
 */
export const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && value > 0 && !isNaN(value);