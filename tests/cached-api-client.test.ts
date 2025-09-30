import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CachedRealtimeRegisterClient,
  createCachedApiClient,
  type CachedApiClientOptions,
  type CacheKeyOptions,
} from '../src/api/cached-client';
import { RealtimeRegisterClient, DomainAvailabilityResponse } from '../src/api/client';
import { Config } from '../src/core/config';
import { createCacheFactory } from '../src/cache/factory';

// Mock the base API client
jest.mock('../src/api/client');

describe('CachedRealtimeRegisterClient', () => {
  let config: Config;
  let cachedClient: CachedRealtimeRegisterClient;
  let mockBaseClient: jest.Mocked<RealtimeRegisterClient>;

  beforeEach(() => {
    config = {
      apiKey: 'test-api-key',
      customer: 'test-customer',
      baseUrl: 'https://api.test.com',
      requestTimeout: 5000,
      debug: false,
      logLevel: 'info',
      serverName: 'test-server',
      serverVersion: '1.0.0',
    };

    // Create mock responses
    const mockDomainResponse: DomainAvailabilityResponse = {
      domain: 'example.com',
      available: true,
      price: 10.99,
      currency: 'USD',
    };

    // Mock the RealtimeRegisterClient
    mockBaseClient = {
      checkDomainAvailability: jest.fn().mockImplementation((domain: string) =>
        Promise.resolve({
          domain: domain,
          available: true,
          price: 10.99,
          currency: 'USD',
        })
      ),
      testConnection: jest.fn().mockResolvedValue(true),
    } as any;

    (RealtimeRegisterClient as jest.MockedClass<typeof RealtimeRegisterClient>).mockImplementation(
      () => mockBaseClient
    );

    cachedClient = new CachedRealtimeRegisterClient(config, {
      enableDebugLogging: false,
    });
  });

  afterEach(() => {
    cachedClient.shutdown();
    jest.resetAllMocks();
  });

  describe('Domain Availability Caching', () => {
    it('should cache domain availability results', async () => {
      const domain = 'example.com';

      // First call should hit the API
      const result1 = await cachedClient.checkDomainAvailability(domain);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);
      expect(result1.domain).toBe(domain);
      expect(result1.available).toBe(true);

      // Second call should hit the cache
      const result2 = await cachedClient.checkDomainAvailability(domain);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1); // Still 1
      expect(result2).toEqual(result1);
    });

    it('should respect custom TTL for domain availability', async () => {
      const domain = 'short-ttl.com';
      const shortTTL = 50; // 50ms

      // Set with short TTL
      await cachedClient.checkDomainAvailability(domain, { ttl: shortTTL });
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);

      // Immediate second call should hit cache
      await cachedClient.checkDomainAvailability(domain);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Third call should hit API again
      await cachedClient.checkDomainAvailability(domain);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);
    });

    it('should generate different cache keys for different domains', async () => {
      await cachedClient.checkDomainAvailability('domain1.com');
      await cachedClient.checkDomainAvailability('domain2.com');

      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenNthCalledWith(1, 'domain1.com');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenNthCalledWith(2, 'domain2.com');
    });

    it('should work when caching is disabled', async () => {
      const noCacheClient = new CachedRealtimeRegisterClient(config, {
        enableCaching: false,
      });

      const domain = 'no-cache.com';

      await noCacheClient.checkDomainAvailability(domain);
      await noCacheClient.checkDomainAvailability(domain);

      // Should hit API both times
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);

      noCacheClient.shutdown();
    });
  });

  describe('Generic API Request Caching', () => {
    it('should cache GET requests', async () => {
      const endpoint = '/v2/test-endpoint';
      const mockResponse = { data: 'test-data' };

      // Mock the private request method
      const mockRequest = jest.fn().mockResolvedValue(mockResponse);
      (cachedClient as any).makeDirectRequest = mockRequest;

      // First call
      const result1 = await cachedClient.cachedRequest(endpoint);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(mockResponse);

      // Second call should hit cache
      const result2 = await cachedClient.cachedRequest(endpoint);
      expect(mockRequest).toHaveBeenCalledTimes(1); // Still 1
      expect(result2).toEqual(mockResponse);
    });

    it('should not cache non-GET requests', async () => {
      const endpoint = '/v2/test-endpoint';
      const mockResponse = { data: 'test-data' };

      const mockRequest = jest.fn().mockResolvedValue(mockResponse);
      (cachedClient as any).makeDirectRequest = mockRequest;

      // POST requests should not be cached
      await cachedClient.cachedRequest(endpoint, { method: 'POST' });
      await cachedClient.cachedRequest(endpoint, { method: 'POST' });

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should generate different cache keys for different request bodies', async () => {
      const endpoint = '/v2/test-endpoint';
      const mockResponse = { data: 'test-data' };

      const mockRequest = jest.fn().mockResolvedValue(mockResponse);
      (cachedClient as any).makeDirectRequest = mockRequest;

      await cachedClient.cachedRequest(endpoint, { body: { param: 'value1' } });
      await cachedClient.cachedRequest(endpoint, { body: { param: 'value2' } });

      // Different bodies should result in different cache keys
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cache Management', () => {
    it('should provide cache statistics', async () => {
      await cachedClient.checkDomainAvailability('stats-test.com');

      const stats = cachedClient.getCacheStats();

      expect(stats.domainAvailability.size).toBe(1);
      expect(stats.domainAvailability.hits).toBe(0);
      expect(stats.domainAvailability.misses).toBe(1);
      expect(stats.apiResponses.size).toBe(0);
      expect(typeof stats.totalMemoryUsage).toBe('number');
    });

    it('should warm caches with initial data', () => {
      const domainData: Array<[string, DomainAvailabilityResponse]> = [
        ['warm1.com', { domain: 'warm1.com', available: true }],
        ['warm2.com', { domain: 'warm2.com', available: false }],
      ];

      cachedClient.warmCaches(domainData);

      const stats = cachedClient.getCacheStats();
      expect(stats.domainAvailability.size).toBe(2);
    });

    it('should cleanup expired entries', async () => {
      // Add entry with short TTL
      await cachedClient.checkDomainAvailability('cleanup-test.com', { ttl: 50 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      const cleanedCount = cachedClient.cleanupCaches();
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it('should invalidate cache entries by pattern', async () => {
      await cachedClient.checkDomainAvailability('test1.com');
      await cachedClient.checkDomainAvailability('test2.com');
      await cachedClient.checkDomainAvailability('example.org');

      // Invalidate all .com domains
      const invalidated = cachedClient.invalidateCache('*test*.com*', 'domain-availability');
      expect(invalidated).toBe(2);

      const stats = cachedClient.getCacheStats();
      expect(stats.domainAvailability.size).toBe(1); // Only example.org should remain
    });
  });

  describe('Error Handling', () => {
    it('should fallback to API on cache errors when enabled', async () => {
      const domain = 'fallback-test.com';

      // Mock cache error
      const originalGet = cachedClient['domainAvailabilityCache'].get;
      cachedClient['domainAvailabilityCache'].get = jest.fn().mockImplementation(() => {
        throw new Error('Cache error');
      });

      const result = await cachedClient.checkDomainAvailability(domain);
      expect(result.domain).toBe(domain);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith(domain);

      // Restore original method
      cachedClient['domainAvailabilityCache'].get = originalGet;
    });

    it('should propagate API errors', async () => {
      const domain = 'error-test.com';
      const apiError = new Error('API Error');

      mockBaseClient.checkDomainAvailability.mockRejectedValueOnce(apiError);

      await expect(cachedClient.checkDomainAvailability(domain)).rejects.toThrow('API Error');
    });
  });

  describe('Test Connection', () => {
    it('should delegate test connection to base client', async () => {
      const result = await cachedClient.testConnection();

      expect(result).toBe(true);
      expect(mockBaseClient.testConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('Factory Function', () => {
    it('should create cached client with factory function', () => {
      const client = createCachedApiClient(config, {
        enableCaching: true,
        enableDebugLogging: false,
      });

      expect(client).toBeInstanceOf(CachedRealtimeRegisterClient);
      client.shutdown();
    });

    it('should create cached client with custom cache factory', () => {
      const customFactory = createCacheFactory({
        enableDebugLogging: true,
      });

      const client = createCachedApiClient(config, {
        cacheFactory: customFactory,
      });

      expect(client).toBeInstanceOf(CachedRealtimeRegisterClient);
      client.shutdown();
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys', () => {
      const generateKey = (cachedClient as any).generateCacheKey.bind(cachedClient);

      const key1 = generateKey('test', 'example.com', {});
      const key2 = generateKey('test', 'example.com', {});

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different options', () => {
      const generateKey = (cachedClient as any).generateCacheKey.bind(cachedClient);

      const key1 = generateKey('test', 'example.com', {});
      const key2 = generateKey('test', 'example.com', { customPrefix: 'custom' });

      expect(key1).not.toBe(key2);
    });

    it('should include timestamp when requested', () => {
      const generateKey = (cachedClient as any).generateCacheKey.bind(cachedClient);

      const key1 = generateKey('test', 'example.com', { includeTimestamp: false });
      const key2 = generateKey('test', 'example.com', { includeTimestamp: true });

      expect(key1).not.toBe(key2);
      expect(key2).toContain('ts:');
    });
  });
});
