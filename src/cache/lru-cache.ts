/**
 * LRU Cache implementation with TTL (Time To Live) support
 * Provides efficient caching with automatic expiration and size-based eviction
 */

import { createLogger, type Logger } from '../core/logger.js';

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  size?: number; // Estimated size in bytes for memory tracking
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  cleanups: number;
  size: number;
  maxSize: number;
  hitRate: number;
  memoryUsage: number; // Estimated memory usage in bytes
  memoryThreshold: number; // Memory threshold in bytes
}

export interface CacheOptions {
  maxSize?: number;
  defaultTTL?: number;
  cleanupInterval?: number;
  memoryThreshold?: number; // Memory threshold in bytes
  enableDebugLogging?: boolean;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;
  private cleanupInterval: number;
  private memoryThreshold: number;
  private enableDebugLogging: boolean;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private logger: Logger;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private cleanups = 0;
  private currentMemoryUsage = 0;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000; // 5 minutes default
    this.cleanupInterval = options.cleanupInterval ?? 60 * 1000; // 1 minute cleanup
    this.memoryThreshold = options.memoryThreshold ?? 50 * 1024 * 1024; // 50MB default
    this.enableDebugLogging = options.enableDebugLogging ?? false;
    this.logger = createLogger(this.enableDebugLogging ? 'debug' : 'warn');

    this.startCleanupTimer();
  }

  /**
   * Retrieve a value from the cache
   * @param key The cache key
   * @returns The cached value or null if not found or expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      if (this.enableDebugLogging) {
        this.logger.debug(`Cache miss for key: ${key}`);
      }
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.updateMemoryUsage(key, entry, 'delete');
      this.misses++;
      if (this.enableDebugLogging) {
        this.logger.debug(`Cache miss (expired) for key: ${key}`);
      }
      return null;
    }

    // Move to end (most recently used) by deleting and re-setting
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;

    if (this.enableDebugLogging) {
      this.logger.debug(`Cache hit for key: ${key}`);
    }

    return entry.value;
  }

  /**
   * Store a value in the cache
   * @param key The cache key
   * @param value The value to cache
   * @param ttl Optional TTL in milliseconds (uses default if not provided)
   */
  set(key: string, value: T, ttl?: number): void {
    const actualTTL = ttl ?? this.defaultTTL;
    const estimatedSize = this.estimateSize(key, value);

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existingEntry = this.cache.get(key);
      this.cache.delete(key);
      if (existingEntry) {
        this.updateMemoryUsage(key, existingEntry, 'delete');
      }
    }
    // Evict least recently used item if at capacity
    else if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: actualTTL,
      size: estimatedSize,
    };

    this.cache.set(key, entry);
    this.updateMemoryUsage(key, entry, 'add');

    if (this.enableDebugLogging) {
      this.logger.debug(
        `Cache set for key: ${key}, size: ${estimatedSize} bytes, TTL: ${actualTTL}ms`
      );
    }

    // Check if we've exceeded memory threshold
    if (this.currentMemoryUsage > this.memoryThreshold) {
      this.performMemoryCleanup();
    }
  }

  /**
   * Check if a key exists in the cache (without updating LRU order)
   * @param key The cache key
   * @returns True if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a specific key from the cache
   * @param key The cache key to delete
   * @returns True if the key was deleted, false if it didn't exist
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    const deleted = this.cache.delete(key);

    if (deleted && entry) {
      this.updateMemoryUsage(key, entry, 'delete');
      if (this.enableDebugLogging) {
        this.logger.debug(`Deleted cache entry with key: ${key}`);
      }
    }

    return deleted;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.resetMetrics();
  }

  /**
   * Get cache statistics
   * @returns Object containing cache performance metrics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      cleanups: this.cleanups,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryUsage: this.currentMemoryUsage,
      memoryThreshold: this.memoryThreshold,
    };
  }

  /**
   * Get current cache size
   * @returns Number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all cache keys (useful for debugging)
   * @returns Array of all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Manually trigger cleanup of expired entries
   * @returns Number of entries cleaned up
   */
  cleanup(): number {
    const initialSize = this.cache.size;
    // const now = Date.now(); // Not used in current implementation

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.updateMemoryUsage(key, entry, 'delete');
      }
    }

    const cleanedCount = initialSize - this.cache.size;
    if (cleanedCount > 0) {
      this.cleanups++;
      if (this.enableDebugLogging) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired entries`);
      }
    }

    return cleanedCount;
  }

  /**
   * Shutdown the cache and clean up resources
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  /**
   * Check if a cache entry has expired
   * @param entry The cache entry to check
   * @returns True if the entry has expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    // Handle zero or negative TTL as immediately expired
    if (entry.ttl <= 0) return true;
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Evict the least recently used item from the cache
   */
  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      if (entry) {
        this.updateMemoryUsage(firstKey, entry, 'delete');
      }
      this.evictions++;

      if (this.enableDebugLogging) {
        this.logger.debug(`Evicted LRU entry with key: ${firstKey}`);
      }
    }
  }

  /**
   * Start the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Reset all metrics to zero
   */
  private resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.cleanups = 0;
    this.currentMemoryUsage = 0;
  }

  /**
   * Estimate the size of a cache entry in bytes
   * @param key The cache key
   * @param value The value to estimate
   * @returns Estimated size in bytes
   */
  private estimateSize(key: string, value: T): number {
    let size = key.length * 2; // Assume 2 bytes per character for key

    if (typeof value === 'string') {
      size += value.length * 2;
    } else if (typeof value === 'number') {
      size += 8;
    } else if (typeof value === 'boolean') {
      size += 1;
    } else if (value && typeof value === 'object') {
      try {
        size += JSON.stringify(value).length * 2;
      } catch {
        size += 100; // Fallback estimate for objects that can't be stringified
      }
    } else {
      size += 50; // Default estimate
    }

    return size + 50; // Add overhead for metadata, timestamps, etc.
  }

  /**
   * Update memory usage tracking
   * @param key The cache key
   * @param entry The cache entry
   * @param operation Whether we're adding or deleting
   */
  private updateMemoryUsage(key: string, entry: CacheEntry<T>, operation: 'add' | 'delete'): void {
    const size = entry.size ?? this.estimateSize(key, entry.value);

    if (operation === 'add') {
      this.currentMemoryUsage += size;
    } else {
      this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - size);
    }

    if (this.enableDebugLogging) {
      this.logger.debug(
        `Memory usage ${operation}: ${size} bytes, total: ${this.currentMemoryUsage} bytes`
      );
    }
  }

  /**
   * Perform memory cleanup when threshold is exceeded
   */
  private performMemoryCleanup(): void {
    if (this.enableDebugLogging) {
      this.logger.debug(
        `Memory threshold exceeded (${this.currentMemoryUsage}/${this.memoryThreshold}), performing cleanup`
      );
    }

    // First, clean up expired entries
    const expiredCleaned = this.cleanup();
    this.cleanups++;

    // If still over threshold, evict oldest entries
    while (this.currentMemoryUsage > this.memoryThreshold && this.cache.size > 0) {
      this.evictLRU();
    }

    if (this.enableDebugLogging) {
      this.logger.debug(
        `Cleanup completed: ${expiredCleaned} expired entries removed, memory usage: ${this.currentMemoryUsage} bytes`
      );
    }
  }
}

/**
 * Create a new LRU cache instance with the specified options
 * @param options Cache configuration options
 * @returns A new LRU cache instance
 */
export function createCache<T>(options?: CacheOptions): LRUCache<T> {
  return new LRUCache<T>(options);
}
