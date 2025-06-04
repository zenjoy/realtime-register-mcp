/**
 * Cached API Client for RealtimeRegister
 * Provides caching layer on top of the base API client
 */

import {
  RealtimeRegisterClient,
  DomainAvailabilityResponse,
  ApiRequestOptions,
  RealtimeRegisterApiError,
  RealtimeRegisterNetworkError,
} from './client.js';
import { Config } from '../core/config.js';
import { LRUCache } from '../cache/lru-cache.js';
import { CacheFactory, createCacheFactory } from '../cache/factory.js';
import { createLogger, type Logger } from '../core/logger.js';
import {
  BulkDomainCheckResult,
  FailedDomainCheck,
  BulkCheckSummary,
  BulkCheckMetadata,
} from './types/domain.js';

export interface CachedApiClientOptions {
  enableCaching?: boolean;
  cacheFactory?: CacheFactory;
  enableDebugLogging?: boolean;
  fallbackOnCacheError?: boolean;
}

export interface CacheKeyOptions {
  includeTimestamp?: boolean;
  customPrefix?: string;
  ttl?: number;
}

export interface CacheStats {
  domainAvailability: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
  };
  apiResponses: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
  };
  totalMemoryUsage: number;
}

/**
 * Cached RealtimeRegister API Client
 *
 * Wraps the base RealtimeRegisterClient with intelligent caching
 */
export class CachedRealtimeRegisterClient {
  private readonly baseClient: RealtimeRegisterClient;
  private readonly options: {
    enableCaching: boolean;
    cacheFactory?: CacheFactory;
    enableDebugLogging: boolean;
    fallbackOnCacheError: boolean;
  };
  private readonly logger: Logger;

  // Cache instances for different data types
  private readonly domainAvailabilityCache: LRUCache<DomainAvailabilityResponse>;
  private readonly apiResponseCache: LRUCache<unknown>;
  private readonly cacheFactory: CacheFactory;

  constructor(config: Config, options: CachedApiClientOptions = {}) {
    this.baseClient = new RealtimeRegisterClient(config);

    this.options = {
      enableCaching: options.enableCaching ?? true,
      enableDebugLogging: options.enableDebugLogging ?? (config.debug || false),
      fallbackOnCacheError: options.fallbackOnCacheError ?? true,
    };

    if (options.cacheFactory) {
      this.options.cacheFactory = options.cacheFactory;
    }

    this.logger = createLogger(this.options.enableDebugLogging ? 'debug' : 'warn');

    // Initialize cache factory
    this.cacheFactory =
      this.options.cacheFactory ||
      createCacheFactory({
        enableDebugLogging: this.options.enableDebugLogging,
      });

    // Initialize specific caches
    this.domainAvailabilityCache =
      this.cacheFactory.getOrCreateCache<DomainAvailabilityResponse>('domain-availability');
    this.apiResponseCache = this.cacheFactory.getOrCreateCache<unknown>('api-responses');

    if (this.options.enableDebugLogging) {
      this.logger.debug('CachedRealtimeRegisterClient initialized', {
        enableCaching: this.options.enableCaching,
        fallbackOnCacheError: this.options.fallbackOnCacheError,
      });
    }
  }

  /**
   * Check domain availability with caching
   *
   * @param domain - The domain name to check
   * @param options - Cache options for this request
   * @returns Promise resolving to domain availability information
   */
  async checkDomainAvailability(
    domain: string,
    options: CacheKeyOptions = {}
  ): Promise<DomainAvailabilityResponse> {
    if (!this.options.enableCaching) {
      return this.baseClient.checkDomainAvailability(domain);
    }

    const cacheKey = this.generateCacheKey('domain-availability', domain, options);

    // Try to get from cache first
    let cachedResult;
    try {
      cachedResult = this.domainAvailabilityCache.get(cacheKey);
    } catch (cacheError) {
      // Handle cache read errors
      if (this.options.fallbackOnCacheError) {
        if (this.options.enableDebugLogging) {
          this.logger.debug(
            `Cache read error for domain ${domain}, falling back to direct API call:`,
            cacheError
          );
        }
        return this.baseClient.checkDomainAvailability(domain);
      }
      throw cacheError;
    }

    if (cachedResult) {
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cache hit for domain availability: ${domain}`);
      }
      return cachedResult;
    }

    if (this.options.enableDebugLogging) {
      this.logger.debug(`Cache miss for domain availability: ${domain}, fetching from API`);
    }

    // Cache miss - fetch from API
    const result = await this.baseClient.checkDomainAvailability(domain);

    // Store in cache
    try {
      const ttl = options.ttl ?? 5 * 60 * 1000; // Default 5 minutes
      this.domainAvailabilityCache.set(cacheKey, result, ttl);
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cached domain availability result for: ${domain}`);
      }
    } catch (cacheError) {
      // Cache write errors are non-fatal
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cache write error for domain ${domain}:`, cacheError);
      }
    }

    return result;
  }

  /**
   * Check availability for multiple domains in parallel with caching
   *
   * @param domains - Array of domain names to check
   * @param options - Cache options for the requests
   * @returns Promise resolving to bulk domain check results
   */
  async checkDomainsAvailability(
    domains: string[],
    options: CacheKeyOptions = {}
  ): Promise<BulkDomainCheckResult> {
    const startTime = new Date();
    const chunkSize = 50; // RealtimeRegister's documented limit

    if (domains.length === 0) {
      return this.createEmptyBulkResult(startTime, 0, chunkSize);
    }

    // Remove duplicates and normalize domains
    const uniqueDomains = [...new Set(domains.map((domain) => domain.toLowerCase().trim()))];
    const chunks = this.chunkArray(uniqueDomains, chunkSize);

    if (this.options.enableDebugLogging) {
      this.logger.debug(
        `Starting bulk domain check for ${uniqueDomains.length} domains in ${chunks.length} chunks`
      );
    }

    const successful: DomainAvailabilityResponse[] = [];
    const failed: FailedDomainCheck[] = [];
    let cacheHits = 0;
    let apiCalls = 0;

    // Process all chunks in parallel
    const chunkResults = await Promise.allSettled(
      chunks.map(async (chunk, chunkIndex) => {
        if (this.options.enableDebugLogging) {
          this.logger.debug(
            `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} domains`
          );
        }

        // Process domains within each chunk in parallel
        const domainResults = await Promise.allSettled(
          chunk.map(async (domain) => {
            try {
              // Check cache first if caching is enabled
              if (this.options.enableCaching) {
                const cacheKey = this.generateCacheKey('domain-availability', domain, options);
                try {
                  const cachedResult = this.domainAvailabilityCache.get(cacheKey);
                  if (cachedResult) {
                    cacheHits++;
                    if (this.options.enableDebugLogging) {
                      this.logger.debug(`Cache hit for domain: ${domain}`);
                    }
                    return cachedResult;
                  }
                } catch (cacheError) {
                  if (this.options.enableDebugLogging) {
                    this.logger.debug(`Cache read error for domain ${domain}:`, cacheError);
                  }
                  // Continue to API call if cache fails and fallback is enabled
                  if (!this.options.fallbackOnCacheError) {
                    throw cacheError;
                  }
                }
              }

              // Make API call
              apiCalls++;
              const result = await this.baseClient.checkDomainAvailability(domain);

              // Cache the result if caching is enabled
              if (this.options.enableCaching) {
                try {
                  const ttl = options.ttl ?? 5 * 60 * 1000; // Default 5 minutes
                  const cacheKey = this.generateCacheKey('domain-availability', domain, options);
                  this.domainAvailabilityCache.set(cacheKey, result, ttl);
                  if (this.options.enableDebugLogging) {
                    this.logger.debug(`Cached result for domain: ${domain}`);
                  }
                } catch (cacheError) {
                  if (this.options.enableDebugLogging) {
                    this.logger.debug(`Cache write error for domain ${domain}:`, cacheError);
                  }
                  // Cache write errors are non-fatal
                }
              }

              return result;
            } catch (error) {
              // Determine error type and create failed domain check entry
              const errorType = this.determineErrorType(error);
              const errorCode = this.extractErrorCode(error);
              const failedCheck: FailedDomainCheck = {
                domain,
                error: error instanceof Error ? error.message : String(error),
                errorType,
                ...(errorCode && { errorCode }),
              };

              if (this.options.enableDebugLogging) {
                this.logger.debug(`Failed to check domain ${domain}:`, error);
              }

              throw failedCheck;
            }
          })
        );

        // Separate successful and failed results for this chunk
        const chunkSuccessful: DomainAvailabilityResponse[] = [];
        const chunkFailed: FailedDomainCheck[] = [];

        domainResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            chunkSuccessful.push(result.value);
          } else {
            chunkFailed.push(result.reason as FailedDomainCheck);
          }
        });

        return { successful: chunkSuccessful, failed: chunkFailed };
      })
    );

    // Aggregate results from all chunks
    chunkResults.forEach((chunkResult) => {
      if (chunkResult.status === 'fulfilled') {
        successful.push(...chunkResult.value.successful);
        failed.push(...chunkResult.value.failed);
      } else {
        // If an entire chunk failed, mark all domains in that chunk as failed
        if (this.options.enableDebugLogging) {
          this.logger.debug('Entire chunk failed:', chunkResult.reason);
        }
        // This shouldn't happen with our current implementation since we handle errors at the domain level
        // But we include it for robustness
      }
    });

    const endTime = new Date();
    const processingTimeMs = endTime.getTime() - startTime.getTime();

    const summary: BulkCheckSummary = {
      totalDomains: uniqueDomains.length,
      successfulChecks: successful.length,
      failedChecks: failed.length,
      cacheHits,
      apiCalls,
      successRate: uniqueDomains.length > 0 ? (successful.length / uniqueDomains.length) * 100 : 0,
    };

    const metadata: BulkCheckMetadata = {
      startTime,
      endTime,
      processingTimeMs,
      chunkCount: chunks.length,
      chunkSize,
    };

    if (this.options.enableDebugLogging) {
      this.logger.debug('Bulk domain check completed:', {
        totalDomains: summary.totalDomains,
        successful: summary.successfulChecks,
        failed: summary.failedChecks,
        cacheHits: summary.cacheHits,
        apiCalls: summary.apiCalls,
        successRate: `${summary.successRate.toFixed(1)}%`,
        processingTimeMs,
      });
    }

    return {
      successful,
      failed,
      summary,
      metadata,
    };
  }

  /**
   * Test API connectivity (not cached)
   *
   * @returns Promise resolving to true if API is accessible
   */
  async testConnection(): Promise<boolean> {
    return this.baseClient.testConnection();
  }

  /**
   * Make a cached request to any API endpoint
   *
   * @param endpoint - The API endpoint
   * @param options - Request options
   * @param cacheOptions - Cache-specific options
   * @returns Promise resolving to the API response
   */
  async cachedRequest<T = unknown>(
    endpoint: string,
    requestOptions: ApiRequestOptions = {},
    cacheOptions: CacheKeyOptions = {}
  ): Promise<T> {
    // Default to GET method if not specified
    const method = requestOptions.method ?? 'GET';
    const normalizedOptions = { ...requestOptions, method };

    if (!this.options.enableCaching || method !== 'GET') {
      // Don't cache non-GET requests
      return this.makeDirectRequest<T>(endpoint, normalizedOptions);
    }

    const cacheKey = this.generateCacheKey(
      'api-request',
      endpoint,
      cacheOptions,
      normalizedOptions
    );

    // Try cache first
    let cachedResult;
    try {
      cachedResult = this.apiResponseCache.get(cacheKey);
    } catch (cacheError) {
      // Handle cache read errors
      if (this.options.fallbackOnCacheError) {
        if (this.options.enableDebugLogging) {
          this.logger.debug(
            `Cache read error for ${endpoint}, falling back to direct API call:`,
            cacheError
          );
        }
        return this.makeDirectRequest<T>(endpoint, normalizedOptions);
      }
      throw cacheError;
    }

    if (cachedResult) {
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cache hit for API request: ${endpoint}`);
      }
      return cachedResult as T;
    }

    if (this.options.enableDebugLogging) {
      this.logger.debug(`Cache miss for API request: ${endpoint}, fetching from API`);
    }

    // Cache miss - make request
    const result = await this.makeDirectRequest<T>(endpoint, normalizedOptions);

    // Store in cache with default TTL if not specified
    const ttl = cacheOptions.ttl ?? 5 * 60 * 1000; // Default 5 minutes
    try {
      this.apiResponseCache.set(cacheKey, result, ttl);
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cached API response for: ${endpoint}`);
      }
    } catch (cacheError) {
      // Cache write errors are non-fatal
      if (this.options.enableDebugLogging) {
        this.logger.debug(`Cache write error for ${endpoint}:`, cacheError);
      }
    }

    return result;
  }

  /**
   * Invalidate cache entries by pattern
   *
   * @param pattern - Pattern to match cache keys (supports wildcards)
   * @param cacheType - Which cache to invalidate
   */
  invalidateCache(
    pattern: string,
    cacheType: 'domain-availability' | 'api-responses' | 'all' = 'all'
  ): number {
    let invalidatedCount = 0;

    if (cacheType === 'domain-availability' || cacheType === 'all') {
      invalidatedCount += this.invalidateCacheByPattern(this.domainAvailabilityCache, pattern);
    }

    if (cacheType === 'api-responses' || cacheType === 'all') {
      invalidatedCount += this.invalidateCacheByPattern(this.apiResponseCache, pattern);
    }

    if (this.options.enableDebugLogging) {
      this.logger.debug(
        `Invalidated ${invalidatedCount} cache entries matching pattern: ${pattern}`
      );
    }

    return invalidatedCount;
  }

  /**
   * Get comprehensive cache statistics
   *
   * @returns Cache statistics for all cache types
   */
  getCacheStats(): CacheStats {
    const domainStats = this.domainAvailabilityCache.getStats();
    const apiStats = this.apiResponseCache.getStats();

    return {
      domainAvailability: {
        hits: domainStats.hits,
        misses: domainStats.misses,
        hitRate: domainStats.hitRate,
        size: domainStats.size,
      },
      apiResponses: {
        hits: apiStats.hits,
        misses: apiStats.misses,
        hitRate: apiStats.hitRate,
        size: apiStats.size,
      },
      totalMemoryUsage: domainStats.memoryUsage + apiStats.memoryUsage,
    };
  }

  /**
   * Warm up caches with initial data
   *
   * @param domainData - Domain availability data to preload
   * @param apiData - API response data to preload
   */
  warmCaches(
    domainData: Array<[string, DomainAvailabilityResponse]> = [],
    apiData: Array<[string, unknown]> = []
  ): void {
    if (domainData.length > 0) {
      this.cacheFactory.warmCache(this.domainAvailabilityCache, domainData);
    }

    if (apiData.length > 0) {
      this.cacheFactory.warmCache(this.apiResponseCache, apiData);
    }

    if (this.options.enableDebugLogging) {
      this.logger.debug(
        `Warmed caches with ${domainData.length} domain entries and ${apiData.length} API entries`
      );
    }
  }

  /**
   * Perform cleanup on all caches
   *
   * @returns Number of entries cleaned up
   */
  cleanupCaches(): number {
    const domainCleaned = this.domainAvailabilityCache.cleanup();
    const apiCleaned = this.apiResponseCache.cleanup();
    const totalCleaned = domainCleaned + apiCleaned;

    if (this.options.enableDebugLogging) {
      this.logger.debug(
        `Cache cleanup: ${totalCleaned} entries removed (${domainCleaned} domain, ${apiCleaned} API)`
      );
    }

    return totalCleaned;
  }

  /**
   * Gracefully shutdown all caches
   */
  shutdown(): void {
    this.cacheFactory.shutdown();

    if (this.options.enableDebugLogging) {
      this.logger.debug('CachedRealtimeRegisterClient shutdown complete');
    }
  }

  /**
   * Create an empty bulk result for edge cases
   *
   * @param startTime - When the operation started
   * @param totalDomains - Total number of domains processed
   * @param chunkSize - Size of chunks used
   * @returns Empty bulk result
   */
  private createEmptyBulkResult(
    startTime: Date,
    totalDomains: number,
    chunkSize: number
  ): BulkDomainCheckResult {
    const endTime = new Date();
    return {
      successful: [],
      failed: [],
      summary: {
        totalDomains,
        successfulChecks: 0,
        failedChecks: 0,
        cacheHits: 0,
        apiCalls: 0,
        successRate: 0,
      },
      metadata: {
        startTime,
        endTime,
        processingTimeMs: endTime.getTime() - startTime.getTime(),
        chunkCount: 0,
        chunkSize,
      },
    };
  }

  /**
   * Determine the type of error for categorization
   *
   * @param error - The error to categorize
   * @returns Error type classification
   */
  private determineErrorType(error: unknown): 'network' | 'api' | 'validation' | 'unknown' {
    if (error instanceof RealtimeRegisterNetworkError) {
      return 'network';
    }
    if (error instanceof RealtimeRegisterApiError) {
      return 'api';
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('invalid') ||
        message.includes('validation') ||
        message.includes('format')
      ) {
        return 'validation';
      }
      if (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection')
      ) {
        return 'network';
      }
    }
    return 'unknown';
  }

  /**
   * Extract error code from various error types
   *
   * @param error - The error to extract code from
   * @returns Error code if available
   */
  private extractErrorCode(error: unknown): string | undefined {
    if (error instanceof RealtimeRegisterApiError) {
      return error.status.toString();
    }
    if (error instanceof RealtimeRegisterNetworkError) {
      return 'NETWORK_ERROR';
    }
    if (error instanceof Error && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return undefined;
  }

  /**
   * Split an array into chunks of specified size
   *
   * @param array - Array to chunk
   * @param size - Maximum size of each chunk
   * @returns Array of chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    if (size <= 0) {
      throw new Error('Chunk size must be greater than 0');
    }

    if (array.length === 0) {
      return [];
    }

    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Generate a cache key for the given parameters
   *
   * @param type - The type of cache key
   * @param identifier - The main identifier (domain, endpoint, etc.)
   * @param options - Cache options
   * @param requestOptions - Request options (for API requests)
   * @returns Generated cache key
   */
  private generateCacheKey(
    type: string,
    identifier: string,
    options: CacheKeyOptions = {},
    requestOptions?: ApiRequestOptions
  ): string {
    const parts = [options.customPrefix || type, identifier.toLowerCase()];

    // Add request method and body hash for API requests
    if (requestOptions) {
      parts.push(requestOptions.method || 'GET');

      if (requestOptions.body) {
        // Create a simple hash of the body for cache key uniqueness
        const bodyStr = JSON.stringify(requestOptions.body);
        const bodyHash = this.simpleHash(bodyStr);
        parts.push(`body:${bodyHash}`);
      }
    }

    // Add timestamp if requested (useful for time-sensitive data)
    if (options.includeTimestamp) {
      const timestamp = Math.floor(Date.now() / 60000); // 1-minute precision
      parts.push(`ts:${timestamp}`);
    }

    return parts.join(':');
  }

  /**
   * Make a direct API request without caching
   *
   * @param endpoint - The API endpoint
   * @param options - Request options
   * @returns Promise resolving to the API response
   */
  private async makeDirectRequest<T>(endpoint: string, options: ApiRequestOptions): Promise<T> {
    // Attempt to use a generic request method if available on baseClient
    // RealtimeRegisterClient.request is now public, so we can call it directly.
    // The check for typeof this.baseClient.request === 'function' is a runtime safeguard.
    if (typeof this.baseClient.request === 'function') {
      return this.baseClient.request<T>(endpoint, options);
    }
    // Fallback or error if a generic request method is not found
    throw new Error(
      `Generic request method not available on baseClient for endpoint: ${endpoint}. ` +
        `Ensure RealtimeRegisterClient has a public 'request<T>' method.`
    );
  }

  /**
   * Invalidate cache entries by pattern matching
   *
   * @param cache - The cache instance
   * @param pattern - Pattern to match (supports * wildcard)
   * @returns Number of invalidated entries
   */
  private invalidateCacheByPattern(cache: LRUCache<unknown>, pattern: string): number {
    const keys = cache.keys();
    let invalidatedCount = 0;

    // Convert pattern to regex (simple wildcard support)
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);

    for (const key of keys) {
      if (regex.test(key)) {
        cache.delete(key);
        invalidatedCount++;
      }
    }

    return invalidatedCount;
  }

  /**
   * Simple hash function for cache key generation
   *
   * @param str - String to hash
   * @returns Simple hash value
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Create a cached API client instance
 *
 * @param config - RealtimeRegister configuration
 * @param options - Caching options
 * @returns Configured cached API client
 */
export function createCachedApiClient(
  config: Config,
  options?: CachedApiClientOptions
): CachedRealtimeRegisterClient {
  return new CachedRealtimeRegisterClient(config, options);
}
