/**
 * Cache Factory and Configuration System
 * Provides preconfigured cache instances for different use cases
 */

import { LRUCache, CacheOptions, createCache, type CacheStats } from './lru-cache.js';
import { createLogger, type Logger } from '../core/logger.js';

export interface CacheConfig extends CacheOptions {
  name: string;
  description?: string;
}

export interface CacheFactoryOptions {
  enableDebugLogging?: boolean;
  globalMemoryThreshold?: number;
  globalCleanupInterval?: number;
}

export type CacheType =
  | 'domain-availability'
  | 'dns-records'
  | 'whois-data'
  | 'api-responses'
  | 'general';

/**
 * Predefined cache configurations for different use cases
 */
export const CACHE_CONFIGS: Record<CacheType, CacheConfig> = {
  'domain-availability': {
    name: 'Domain Availability Cache',
    description: 'Cache for domain availability check results',
    maxSize: 10000,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    cleanupInterval: 2 * 60 * 1000, // 2 minutes
    memoryThreshold: 10 * 1024 * 1024, // 10MB
  },
  'dns-records': {
    name: 'DNS Records Cache',
    description: 'Cache for DNS record lookups',
    maxSize: 5000,
    defaultTTL: 60 * 60 * 1000, // 1 hour
    cleanupInterval: 15 * 60 * 1000, // 15 minutes
    memoryThreshold: 20 * 1024 * 1024, // 20MB
  },
  'whois-data': {
    name: 'WHOIS Data Cache',
    description: 'Cache for WHOIS information',
    maxSize: 2000,
    defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
    cleanupInterval: 60 * 60 * 1000, // 1 hour
    memoryThreshold: 15 * 1024 * 1024, // 15MB
  },
  'api-responses': {
    name: 'API Response Cache',
    description: 'General cache for API responses',
    maxSize: 1000,
    defaultTTL: 10 * 60 * 1000, // 10 minutes
    cleanupInterval: 5 * 60 * 1000, // 5 minutes
    memoryThreshold: 5 * 1024 * 1024, // 5MB
  },
  general: {
    name: 'General Purpose Cache',
    description: 'Default cache for general use',
    maxSize: 1000,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    cleanupInterval: 60 * 1000, // 1 minute
    memoryThreshold: 10 * 1024 * 1024, // 10MB
  },
};

/**
 * Environment variable configuration mapping
 */
export interface EnvironmentConfig {
  CACHE_DOMAIN_AVAILABILITY_TTL?: string;
  CACHE_DOMAIN_AVAILABILITY_SIZE?: string;
  CACHE_DNS_RECORDS_TTL?: string;
  CACHE_DNS_RECORDS_SIZE?: string;
  CACHE_WHOIS_DATA_TTL?: string;
  CACHE_WHOIS_DATA_SIZE?: string;
  CACHE_API_RESPONSES_TTL?: string;
  CACHE_API_RESPONSES_SIZE?: string;
  CACHE_GLOBAL_MEMORY_THRESHOLD?: string;
  CACHE_GLOBAL_CLEANUP_INTERVAL?: string;
  CACHE_DEBUG_LOGGING?: string;
}

/**
 * Cache Factory for creating and managing cache instances
 */
export class CacheFactory {
  private caches = new Map<string, LRUCache<unknown>>();
  private logger: Logger;
  private options: CacheFactoryOptions;

  constructor(options: CacheFactoryOptions = {}) {
    this.options = {
      enableDebugLogging: false,
      globalMemoryThreshold: 50 * 1024 * 1024, // 50MB default
      globalCleanupInterval: 60 * 1000, // 1 minute default
      ...options,
    };

    this.logger = createLogger(this.options.enableDebugLogging ? 'debug' : 'warn');

    if (this.options.enableDebugLogging) {
      this.logger.debug('CacheFactory initialized with options:', this.options);
    }
  }

  /**
   * Create a cache instance with predefined configuration
   * @param type The type of cache to create
   * @param customConfig Optional custom configuration to override defaults
   * @returns A configured cache instance
   */
  createCache<T>(type: CacheType, customConfig?: Partial<CacheConfig>): LRUCache<T> {
    const baseConfig = CACHE_CONFIGS[type];
    const envConfig = this.loadEnvironmentConfig(type);

    const finalConfig: CacheOptions = {
      ...baseConfig,
      ...envConfig,
      ...customConfig,
      enableDebugLogging: this.options.enableDebugLogging ?? false,
    };

    if (this.options.enableDebugLogging) {
      this.logger.debug(`Creating ${type} cache with config:`, finalConfig);
    }

    const cache = createCache<T>(finalConfig);
    const cacheKey = `${type}-${Date.now()}`;
    this.caches.set(cacheKey, cache);

    return cache;
  }

  /**
   * Get or create a singleton cache instance for a specific type
   * @param type The type of cache
   * @param customConfig Optional custom configuration
   * @returns The cache instance
   */
  getOrCreateCache<T>(type: CacheType, customConfig?: Partial<CacheConfig>): LRUCache<T> {
    const existingCache = this.caches.get(type);
    if (existingCache) {
      return existingCache as LRUCache<T>;
    }

    const cache = this.createCache<T>(type, customConfig);
    this.caches.set(type, cache);
    return cache;
  }

  /**
   * Warm up a cache with initial data
   * @param cache The cache instance to warm up
   * @param data Array of key-value pairs to preload
   * @param ttl Optional TTL for preloaded data
   */
  warmCache<T>(cache: LRUCache<T>, data: Array<[string, T]>, ttl?: number): void {
    if (this.options.enableDebugLogging) {
      this.logger.debug(`Warming cache with ${data.length} entries`);
    }

    for (const [key, value] of data) {
      cache.set(key, value, ttl);
    }

    if (this.options.enableDebugLogging) {
      const stats = cache.getStats();
      this.logger.debug(`Cache warmed up. Size: ${stats.size}, Memory: ${stats.memoryUsage} bytes`);
    }
  }

  /**
   * Get statistics for all managed caches
   * @returns Object containing stats for each cache
   */
  getAllCacheStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};

    for (const [key, cache] of this.caches.entries()) {
      stats[key] = cache.getStats();
    }

    return stats;
  }

  /**
   * Perform cleanup on all managed caches
   * @returns Total number of entries cleaned up across all caches
   */
  cleanupAllCaches(): number {
    let totalCleaned = 0;

    for (const [key, cache] of this.caches.entries()) {
      const cleaned = cache.cleanup();
      totalCleaned += cleaned;

      if (cleaned > 0 && this.options.enableDebugLogging) {
        this.logger.debug(`Cleaned ${cleaned} entries from cache: ${key}`);
      }
    }

    if (this.options.enableDebugLogging) {
      this.logger.debug(`Total cleanup: ${totalCleaned} entries across ${this.caches.size} caches`);
    }

    return totalCleaned;
  }

  /**
   * Gracefully shutdown all managed caches
   */
  shutdown(): void {
    if (this.options.enableDebugLogging) {
      this.logger.debug(`Shutting down ${this.caches.size} managed caches`);
    }

    for (const [key, cache] of this.caches.entries()) {
      cache.shutdown();
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Shutdown cache: ${key}`);
      }
    }

    this.caches.clear();

    if (this.options.enableDebugLogging) {
      this.logger.debug('CacheFactory shutdown complete');
    }
  }

  /**
   * Load configuration from environment variables
   * @param type The cache type to load config for
   * @returns Configuration object with environment overrides
   */
  private loadEnvironmentConfig(type: CacheType): Partial<CacheOptions> {
    const config: Partial<CacheOptions> = {};

    // Load global settings
    if (process.env.CACHE_GLOBAL_MEMORY_THRESHOLD) {
      const threshold = parseInt(process.env.CACHE_GLOBAL_MEMORY_THRESHOLD, 10);
      if (!isNaN(threshold)) {
        config.memoryThreshold = threshold;
      }
    }

    if (process.env.CACHE_GLOBAL_CLEANUP_INTERVAL) {
      const interval = parseInt(process.env.CACHE_GLOBAL_CLEANUP_INTERVAL, 10);
      if (!isNaN(interval)) {
        config.cleanupInterval = interval;
      }
    }

    // Load type-specific settings
    switch (type) {
      case 'domain-availability':
        if (process.env.CACHE_DOMAIN_AVAILABILITY_TTL) {
          const ttl = parseInt(process.env.CACHE_DOMAIN_AVAILABILITY_TTL, 10);
          if (!isNaN(ttl)) config.defaultTTL = ttl;
        }
        if (process.env.CACHE_DOMAIN_AVAILABILITY_SIZE) {
          const size = parseInt(process.env.CACHE_DOMAIN_AVAILABILITY_SIZE, 10);
          if (!isNaN(size)) config.maxSize = size;
        }
        break;

      case 'dns-records':
        if (process.env.CACHE_DNS_RECORDS_TTL) {
          const ttl = parseInt(process.env.CACHE_DNS_RECORDS_TTL, 10);
          if (!isNaN(ttl)) config.defaultTTL = ttl;
        }
        if (process.env.CACHE_DNS_RECORDS_SIZE) {
          const size = parseInt(process.env.CACHE_DNS_RECORDS_SIZE, 10);
          if (!isNaN(size)) config.maxSize = size;
        }
        break;

      case 'whois-data':
        if (process.env.CACHE_WHOIS_DATA_TTL) {
          const ttl = parseInt(process.env.CACHE_WHOIS_DATA_TTL, 10);
          if (!isNaN(ttl)) config.defaultTTL = ttl;
        }
        if (process.env.CACHE_WHOIS_DATA_SIZE) {
          const size = parseInt(process.env.CACHE_WHOIS_DATA_SIZE, 10);
          if (!isNaN(size)) config.maxSize = size;
        }
        break;

      case 'api-responses':
        if (process.env.CACHE_API_RESPONSES_TTL) {
          const ttl = parseInt(process.env.CACHE_API_RESPONSES_TTL, 10);
          if (!isNaN(ttl)) config.defaultTTL = ttl;
        }
        if (process.env.CACHE_API_RESPONSES_SIZE) {
          const size = parseInt(process.env.CACHE_API_RESPONSES_SIZE, 10);
          if (!isNaN(size)) config.maxSize = size;
        }
        break;
    }

    return config;
  }
}

/**
 * Create a global cache factory instance
 * @param options Factory configuration options
 * @returns A configured cache factory
 */
export function createCacheFactory(options?: CacheFactoryOptions): CacheFactory {
  return new CacheFactory(options);
}

/**
 * Default cache factory instance for convenience
 */
export const defaultCacheFactory = createCacheFactory({
  enableDebugLogging: process.env.CACHE_DEBUG_LOGGING === 'true',
});

/**
 * Convenience functions for common cache types
 */
export const CacheFactoryHelpers = {
  /**
   * Create a domain availability cache
   */
  createDomainAvailabilityCache: <T = unknown>(customConfig?: Partial<CacheConfig>) =>
    defaultCacheFactory.createCache<T>('domain-availability', customConfig),

  /**
   * Create a DNS records cache
   */
  createDNSRecordsCache: <T = unknown>(customConfig?: Partial<CacheConfig>) =>
    defaultCacheFactory.createCache<T>('dns-records', customConfig),

  /**
   * Create a WHOIS data cache
   */
  createWhoisDataCache: <T = unknown>(customConfig?: Partial<CacheConfig>) =>
    defaultCacheFactory.createCache<T>('whois-data', customConfig),

  /**
   * Create an API responses cache
   */
  createAPIResponsesCache: <T = unknown>(customConfig?: Partial<CacheConfig>) =>
    defaultCacheFactory.createCache<T>('api-responses', customConfig),

  /**
   * Create a general purpose cache
   */
  createGeneralCache: <T = unknown>(customConfig?: Partial<CacheConfig>) =>
    defaultCacheFactory.createCache<T>('general', customConfig),
};
