import { describe, test, expect, beforeEach, afterEach, it, jest } from '@jest/globals';
import { CachedRealtimeRegisterClient } from '../src/api/cached-client.js';
import { loadConfig, Config } from '../src/core/config.js';
import {
  RealtimeRegisterClient,
  DomainAvailabilityResponse,
  RealtimeRegisterApiError,
  RealtimeRegisterNetworkError,
} from '../src/api/client.js';

describe('Bulk Domain Availability - Batch Processing Logic', () => {
  let client: CachedRealtimeRegisterClient;

  beforeEach(() => {
    const config = loadConfig();
    client = new CachedRealtimeRegisterClient(config, {
      enableCaching: false, // Disable caching for pure logic testing
      enableDebugLogging: false,
    });
  });

  afterEach(() => {
    client.shutdown();
  });

  describe('chunkArray functionality', () => {
    test('should handle empty arrays', () => {
      const result = (client as any).chunkArray([], 50);
      expect(result).toEqual([]);
    });

    test('should handle arrays smaller than chunk size', () => {
      const domains = ['example.com', 'test.org', 'demo.net'];
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toEqual([domains]);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(3);
    });

    test('should handle arrays exactly equal to chunk size', () => {
      const domains = Array.from({ length: 50 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(50);
      expect(result[0]).toEqual(domains);
    });

    test('should handle arrays slightly larger than chunk size', () => {
      const domains = Array.from({ length: 51 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(1);
      expect(result[1][0]).toBe('domain50.com');
    });

    test('should handle arrays exactly double the chunk size', () => {
      const domains = Array.from({ length: 100 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(50);
      expect(result[0][0]).toBe('domain0.com');
      expect(result[0][49]).toBe('domain49.com');
      expect(result[1][0]).toBe('domain50.com');
      expect(result[1][49]).toBe('domain99.com');
    });

    test('should handle arrays not evenly divisible by chunk size', () => {
      const domains = Array.from({ length: 123 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(50);
      expect(result[2]).toHaveLength(23);
      expect(result[2][0]).toBe('domain100.com');
      expect(result[2][22]).toBe('domain122.com');
    });

    test('should handle single domain', () => {
      const domains = ['single.com'];
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1);
      expect(result[0][0]).toBe('single.com');
    });

    test('should handle large arrays efficiently', () => {
      const domains = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);
      expect(result).toHaveLength(20);

      // Verify all chunks except the last have exactly 50 elements
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]).toHaveLength(50);
      }

      // Verify last chunk has correct number of elements
      expect(result[result.length - 1]).toHaveLength(50);

      // Verify no domains are lost or duplicated
      const flattened = result.flat();
      expect(flattened).toHaveLength(1000);
      expect(flattened).toEqual(domains);
    });

    test('should preserve domain order across chunks', () => {
      const domains = Array.from({ length: 75 }, (_, i) => `domain${i}.com`);
      const result = (client as any).chunkArray(domains, 50);

      expect(result).toHaveLength(2);
      expect(result[0][0]).toBe('domain0.com');
      expect(result[0][49]).toBe('domain49.com');
      expect(result[1][0]).toBe('domain50.com');
      expect(result[1][24]).toBe('domain74.com');
    });

    test('should handle different chunk sizes', () => {
      const domains = Array.from({ length: 25 }, (_, i) => `domain${i}.com`);

      // Test chunk size of 10
      const result10 = (client as any).chunkArray(domains, 10);
      expect(result10).toHaveLength(3);
      expect(result10[0]).toHaveLength(10);
      expect(result10[1]).toHaveLength(10);
      expect(result10[2]).toHaveLength(5);

      // Test chunk size of 1
      const result1 = (client as any).chunkArray(domains, 1);
      expect(result1).toHaveLength(25);
      result1.forEach((chunk) => expect(chunk).toHaveLength(1));
    });

    test('should throw error for invalid chunk size', () => {
      const domains = ['test.com'];

      expect(() => (client as any).chunkArray(domains, 0)).toThrow(
        'Chunk size must be greater than 0'
      );
      expect(() => (client as any).chunkArray(domains, -1)).toThrow(
        'Chunk size must be greater than 0'
      );
      expect(() => (client as any).chunkArray(domains, -50)).toThrow(
        'Chunk size must be greater than 0'
      );
    });

    test('should handle non-string array elements', () => {
      const numbers = Array.from({ length: 75 }, (_, i) => i);
      const result = (client as any).chunkArray(numbers, 50);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(50);
      expect(result[1]).toHaveLength(25);
      expect(result[0][0]).toBe(0);
      expect(result[0][49]).toBe(49);
      expect(result[1][0]).toBe(50);
      expect(result[1][24]).toBe(74);
    });
  });
});

describe('Bulk Domain Availability - Parallel API Requests', () => {
  let mockBaseClient: jest.Mocked<RealtimeRegisterClient>;
  let cachedClient: CachedRealtimeRegisterClient;
  let config: Config;

  beforeEach(() => {
    config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.yoursrs.com',
      requestTimeout: 30000,
      debug: false,
      logLevel: 'info',
      serverName: 'test-server',
      serverVersion: '1.0.0',
    };

    const mockDomainResponse = (
      domain: string,
      available: boolean = true
    ): DomainAvailabilityResponse => ({
      domain,
      available,
      price: available ? 12.99 : undefined,
      currency: available ? 'USD' : undefined,
      reason: available ? undefined : 'Domain is already registered',
    });

    mockBaseClient = {
      checkDomainAvailability: jest
        .fn()
        .mockImplementation((domain: string) => Promise.resolve(mockDomainResponse(domain))),
      testConnection: jest.fn().mockResolvedValue(true),
    } as jest.Mocked<RealtimeRegisterClient>;

    cachedClient = new CachedRealtimeRegisterClient(config, {
      enableCaching: true,
      enableDebugLogging: false,
      fallbackOnCacheError: true,
    });

    // Replace the base client with our mock
    (cachedClient as any).baseClient = mockBaseClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic functionality', () => {
    it('should handle empty domain array', async () => {
      const result = await cachedClient.checkDomainsAvailability([]);

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.summary.totalDomains).toBe(0);
      expect(result.summary.successfulChecks).toBe(0);
      expect(result.summary.failedChecks).toBe(0);
      expect(result.summary.successRate).toBe(0);
      expect(mockBaseClient.checkDomainAvailability).not.toHaveBeenCalled();
    });

    it('should check single domain successfully', async () => {
      const domains = ['example.com'];
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.successful[0].domain).toBe('example.com');
      expect(result.successful[0].available).toBe(true);
      expect(result.summary.totalDomains).toBe(1);
      expect(result.summary.successfulChecks).toBe(1);
      expect(result.summary.failedChecks).toBe(0);
      expect(result.summary.successRate).toBe(100);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);
    });

    it('should check multiple domains successfully', async () => {
      const domains = ['example.com', 'test.org', 'sample.net'];
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(result.summary.totalDomains).toBe(3);
      expect(result.summary.successfulChecks).toBe(3);
      expect(result.summary.failedChecks).toBe(0);
      expect(result.summary.successRate).toBe(100);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(3);
    });

    it('should remove duplicate domains', async () => {
      const domains = ['example.com', 'EXAMPLE.COM', 'example.com', 'test.org'];
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(2);
      expect(result.summary.totalDomains).toBe(2);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('example.com');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('test.org');
    });

    it('should normalize domain names to lowercase', async () => {
      const domains = ['EXAMPLE.COM', 'Test.ORG'];
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(2);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('example.com');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('test.org');
    });
  });

  describe('Chunking behavior', () => {
    it('should process domains in chunks of 50', async () => {
      // Create 123 domains to test chunking (should create 3 chunks: 50, 50, 23)
      const domains = Array.from({ length: 123 }, (_, i) => `domain${i}.com`);
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(123);
      expect(result.metadata.chunkCount).toBe(3);
      expect(result.metadata.chunkSize).toBe(50);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(123);
    });

    it('should handle exactly 50 domains in one chunk', async () => {
      const domains = Array.from({ length: 50 }, (_, i) => `domain${i}.com`);
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(50);
      expect(result.metadata.chunkCount).toBe(1);
      expect(result.metadata.chunkSize).toBe(50);
    });

    it('should handle exactly 100 domains in two chunks', async () => {
      const domains = Array.from({ length: 100 }, (_, i) => `domain${i}.com`);
      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(100);
      expect(result.metadata.chunkCount).toBe(2);
      expect(result.metadata.chunkSize).toBe(50);
    });
  });

  describe('Error handling', () => {
    it('should handle individual domain failures gracefully', async () => {
      const domains = ['good1.com', 'bad.com', 'good2.com'];

      mockBaseClient.checkDomainAvailability.mockImplementation((domain: string) => {
        if (domain === 'bad.com') {
          return Promise.reject(new RealtimeRegisterApiError('Domain not found', 404, 'Not Found'));
        }
        return Promise.resolve({
          domain,
          available: true,
          price: 12.99,
          currency: 'USD',
        });
      });

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].domain).toBe('bad.com');
      expect(result.failed[0].errorType).toBe('api');
      expect(result.failed[0].errorCode).toBe('404');
      expect(result.summary.successRate).toBeCloseTo(66.67, 1);
    });

    it('should categorize network errors correctly', async () => {
      const domains = ['network-error.com'];

      mockBaseClient.checkDomainAvailability.mockRejectedValue(
        new RealtimeRegisterNetworkError('Connection timeout')
      );

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].errorType).toBe('network');
      expect(result.failed[0].errorCode).toBe('NETWORK_ERROR');
    });

    it('should categorize validation errors correctly', async () => {
      const domains = ['invalid-domain'];

      mockBaseClient.checkDomainAvailability.mockRejectedValue(new Error('Invalid domain format'));

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.failed[0].errorType).toBe('validation');
    });

    it('should handle unknown errors', async () => {
      const domains = ['unknown-error.com'];

      mockBaseClient.checkDomainAvailability.mockRejectedValue('Unknown error');

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.failed[0].errorType).toBe('unknown');
      expect(result.failed[0].error).toBe('Unknown error');
    });

    it('should continue processing other domains when some fail', async () => {
      const domains = Array.from({ length: 10 }, (_, i) => `domain${i}.com`);

      mockBaseClient.checkDomainAvailability.mockImplementation((domain: string) => {
        // Fail every 3rd domain
        if (domain.includes('3') || domain.includes('6') || domain.includes('9')) {
          return Promise.reject(new Error('Simulated failure'));
        }
        return Promise.resolve({
          domain,
          available: true,
          price: 12.99,
          currency: 'USD',
        });
      });

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(7);
      expect(result.failed).toHaveLength(3);
      expect(result.summary.totalDomains).toBe(10);
    });
  });

  describe('Caching integration', () => {
    it('should use cached results when available', async () => {
      const domain = 'cached-domain.com';

      // First call - should hit API
      await cachedClient.checkDomainsAvailability([domain]);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result = await cachedClient.checkDomainsAvailability([domain]);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1); // Still 1
      expect(result.summary.cacheHits).toBe(1);
      expect(result.summary.apiCalls).toBe(0);
    });

    it('should mix cached and new domains correctly', async () => {
      const cachedDomain = 'cached.com';
      const newDomain = 'new.com';

      // Cache one domain
      await cachedClient.checkDomainsAvailability([cachedDomain]);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);

      // Check both cached and new domain
      const result = await cachedClient.checkDomainsAvailability([cachedDomain, newDomain]);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);
      expect(result.summary.cacheHits).toBe(1);
      expect(result.summary.apiCalls).toBe(1);
      expect(result.successful).toHaveLength(2);
    });

    it('should cache successful results from bulk operations', async () => {
      const domains = ['cache-test1.com', 'cache-test2.com'];

      // First bulk call
      await cachedClient.checkDomainsAvailability(domains);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2);

      // Individual calls should use cache
      await cachedClient.checkDomainAvailability('cache-test1.com');
      await cachedClient.checkDomainAvailability('cache-test2.com');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(2); // Still 2
    });

    it('should work with caching disabled', async () => {
      const noCacheClient = new CachedRealtimeRegisterClient(config, {
        enableCaching: false,
      });
      (noCacheClient as any).baseClient = mockBaseClient;

      const domains = ['no-cache1.com', 'no-cache2.com'];

      // First call
      const result1 = await noCacheClient.checkDomainsAvailability(domains);
      expect(result1.summary.cacheHits).toBe(0);
      expect(result1.summary.apiCalls).toBe(2);

      // Second call - should hit API again
      const result2 = await noCacheClient.checkDomainsAvailability(domains);
      expect(result2.summary.cacheHits).toBe(0);
      expect(result2.summary.apiCalls).toBe(2);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(4);
    });
  });

  describe('Performance and metadata', () => {
    it('should provide accurate timing metadata', async () => {
      const domains = ['timing-test.com'];
      const startTime = Date.now();

      const result = await cachedClient.checkDomainsAvailability(domains);
      const endTime = Date.now();

      expect(result.metadata.startTime).toBeInstanceOf(Date);
      expect(result.metadata.endTime).toBeInstanceOf(Date);
      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.processingTimeMs).toBeLessThan(endTime - startTime + 100); // Allow some margin
      expect(result.metadata.endTime.getTime()).toBeGreaterThanOrEqual(
        result.metadata.startTime.getTime()
      );
    });

    it('should provide accurate summary statistics', async () => {
      const domains = ['stat1.com', 'stat2.com', 'stat3.com'];

      mockBaseClient.checkDomainAvailability.mockImplementation((domain: string) => {
        if (domain === 'stat2.com') {
          return Promise.reject(new Error('Test failure'));
        }
        return Promise.resolve({
          domain,
          available: true,
          price: 12.99,
          currency: 'USD',
        });
      });

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.summary.totalDomains).toBe(3);
      expect(result.summary.successfulChecks).toBe(2);
      expect(result.summary.failedChecks).toBe(1);
      expect(result.summary.cacheHits).toBe(0);
      expect(result.summary.apiCalls).toBe(3);
      expect(result.summary.successRate).toBeCloseTo(66.67, 1);
    });

    it('should handle large numbers of domains efficiently', async () => {
      const domains = Array.from({ length: 200 }, (_, i) => `large-test${i}.com`);

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(200);
      expect(result.metadata.chunkCount).toBe(4); // 200 / 50 = 4 chunks
      expect(result.summary.successRate).toBe(100);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(200);
    });
  });

  describe('Edge cases', () => {
    it('should handle domains with whitespace', async () => {
      const domains = ['  spaced.com  ', '\ttabbed.org\t', '\nnewlined.net\n'];

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(3);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('spaced.com');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('tabbed.org');
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('newlined.net');
    });

    it('should handle mixed case duplicates correctly', async () => {
      const domains = ['Example.COM', 'example.com', 'EXAMPLE.com', 'example.COM'];

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(1);
      expect(result.summary.totalDomains).toBe(1);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledTimes(1);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('example.com');
    });

    it('should handle cache errors gracefully with fallback enabled', async () => {
      const domains = ['cache-error.com'];

      // Mock cache to throw error
      const originalGet = (cachedClient as any).domainAvailabilityCache.get;
      (cachedClient as any).domainAvailabilityCache.get = jest.fn().mockImplementation(() => {
        throw new Error('Cache read error');
      });

      const result = await cachedClient.checkDomainsAvailability(domains);

      expect(result.successful).toHaveLength(1);
      expect(mockBaseClient.checkDomainAvailability).toHaveBeenCalledWith('cache-error.com');

      // Restore original method
      (cachedClient as any).domainAvailabilityCache.get = originalGet;
    });
  });
});
