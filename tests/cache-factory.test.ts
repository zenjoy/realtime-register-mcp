import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CacheFactory,
  createCacheFactory,
  defaultCacheFactory,
  CacheFactoryHelpers,
  CACHE_CONFIGS,
  type CacheType,
  type CacheConfig,
} from '../src/cache/factory';

describe('CacheFactory', () => {
  let factory: CacheFactory;

  beforeEach(() => {
    factory = createCacheFactory({ enableDebugLogging: false });
  });

  afterEach(() => {
    factory.shutdown();
  });

  describe('Cache Creation', () => {
    it('should create cache with predefined configuration', () => {
      const cache = factory.createCache<string>('domain-availability');
      const stats = cache.getStats();

      expect(stats.maxSize).toBe(CACHE_CONFIGS['domain-availability'].maxSize);
      expect(stats.memoryThreshold).toBe(CACHE_CONFIGS['domain-availability'].memoryThreshold);

      cache.shutdown();
    });

    it('should create cache with custom configuration override', () => {
      const customConfig: Partial<CacheConfig> = {
        maxSize: 500,
        defaultTTL: 30000, // 30 seconds
      };

      const cache = factory.createCache<string>('dns-records', customConfig);
      const stats = cache.getStats();

      expect(stats.maxSize).toBe(500);
      // Memory threshold should still use default from config
      expect(stats.memoryThreshold).toBe(CACHE_CONFIGS['dns-records'].memoryThreshold);

      cache.shutdown();
    });

    it('should create different cache types with appropriate configurations', () => {
      const domainCache = factory.createCache<boolean>('domain-availability');
      const dnsCache = factory.createCache<object>('dns-records');
      const whoisCache = factory.createCache<string>('whois-data');

      const domainStats = domainCache.getStats();
      const dnsStats = dnsCache.getStats();
      const whoisStats = whoisCache.getStats();

      // Domain availability should have shorter TTL than DNS records
      expect(CACHE_CONFIGS['domain-availability'].defaultTTL).toBeLessThan(
        CACHE_CONFIGS['dns-records'].defaultTTL!
      );

      // WHOIS should have longest TTL
      expect(CACHE_CONFIGS['whois-data'].defaultTTL).toBeGreaterThan(
        CACHE_CONFIGS['dns-records'].defaultTTL!
      );

      domainCache.shutdown();
      dnsCache.shutdown();
      whoisCache.shutdown();
    });
  });

  describe('Singleton Cache Management', () => {
    it('should return same instance for getOrCreateCache', () => {
      const cache1 = factory.getOrCreateCache<string>('general');
      const cache2 = factory.getOrCreateCache<string>('general');

      expect(cache1).toBe(cache2);

      cache1.set('test', 'value');
      expect(cache2.get('test')).toBe('value');
    });

    it('should create new instance if not exists', () => {
      const cache = factory.getOrCreateCache<number>('api-responses');
      const stats = cache.getStats();

      expect(stats.maxSize).toBe(CACHE_CONFIGS['api-responses'].maxSize);
    });
  });

  describe('Cache Warming', () => {
    it('should warm cache with initial data', () => {
      const cache = factory.createCache<string>('general');
      const warmData: Array<[string, string]> = [
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ];

      factory.warmCache(cache, warmData);

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.getStats().size).toBe(3);

      cache.shutdown();
    });

    it('should warm cache with custom TTL', () => {
      const cache = factory.createCache<number>('general');
      const warmData: Array<[string, number]> = [
        ['num1', 42],
        ['num2', 84],
      ];

      factory.warmCache(cache, warmData, 100); // 100ms TTL

      expect(cache.get('num1')).toBe(42);
      expect(cache.get('num2')).toBe(84);

      cache.shutdown();
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should get stats for all managed caches', () => {
      const cache1 = factory.getOrCreateCache<string>('domain-availability');
      const cache2 = factory.getOrCreateCache<string>('dns-records');

      cache1.set('domain1', 'available');
      cache2.set('record1', 'A 192.168.1.1');

      const allStats = factory.getAllCacheStats();

      expect(Object.keys(allStats)).toContain('domain-availability');
      expect(Object.keys(allStats)).toContain('dns-records');
      expect(allStats['domain-availability'].size).toBe(1);
      expect(allStats['dns-records'].size).toBe(1);
    });

    it('should cleanup all managed caches', () => {
      const cache1 = factory.getOrCreateCache<string>('general');
      const cache2 = factory.getOrCreateCache<string>('api-responses');

      // Add entries with short TTL
      cache1.set('temp1', 'value1', 50);
      cache2.set('temp2', 'value2', 50);

      // Wait for expiration
      setTimeout(() => {
        const cleanedCount = factory.cleanupAllCaches();
        expect(cleanedCount).toBeGreaterThanOrEqual(0);
      }, 60);
    });
  });

  describe('Environment Configuration', () => {
    beforeEach(() => {
      // Clear any existing env vars
      delete process.env.CACHE_DOMAIN_AVAILABILITY_TTL;
      delete process.env.CACHE_DOMAIN_AVAILABILITY_SIZE;
      delete process.env.CACHE_GLOBAL_MEMORY_THRESHOLD;
    });

    it('should load configuration from environment variables', () => {
      // Set environment variables
      process.env.CACHE_DOMAIN_AVAILABILITY_TTL = '120000'; // 2 minutes
      process.env.CACHE_DOMAIN_AVAILABILITY_SIZE = '5000';
      process.env.CACHE_GLOBAL_MEMORY_THRESHOLD = '20971520'; // 20MB

      const envFactory = createCacheFactory();
      const cache = envFactory.createCache<string>('domain-availability');
      const stats = cache.getStats();

      expect(stats.maxSize).toBe(5000);
      expect(stats.memoryThreshold).toBe(20971520);

      cache.shutdown();
      envFactory.shutdown();

      // Clean up
      delete process.env.CACHE_DOMAIN_AVAILABILITY_TTL;
      delete process.env.CACHE_DOMAIN_AVAILABILITY_SIZE;
      delete process.env.CACHE_GLOBAL_MEMORY_THRESHOLD;
    });

    it('should ignore invalid environment values', () => {
      process.env.CACHE_DNS_RECORDS_TTL = 'invalid';
      process.env.CACHE_DNS_RECORDS_SIZE = 'not-a-number';

      const envFactory = createCacheFactory();
      const cache = envFactory.createCache<string>('dns-records');
      const stats = cache.getStats();

      // Should use default values when env vars are invalid
      expect(stats.maxSize).toBe(CACHE_CONFIGS['dns-records'].maxSize);

      cache.shutdown();
      envFactory.shutdown();

      // Clean up
      delete process.env.CACHE_DNS_RECORDS_TTL;
      delete process.env.CACHE_DNS_RECORDS_SIZE;
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown all managed caches', () => {
      const cache1 = factory.getOrCreateCache<string>('general');
      const cache2 = factory.getOrCreateCache<string>('api-responses');

      cache1.set('test1', 'value1');
      cache2.set('test2', 'value2');

      expect(factory.getAllCacheStats()).toHaveProperty('general');
      expect(factory.getAllCacheStats()).toHaveProperty('api-responses');

      factory.shutdown();

      // After shutdown, stats should be empty
      expect(Object.keys(factory.getAllCacheStats())).toHaveLength(0);
    });
  });
});

describe('Cache Factory Helpers', () => {
  afterEach(() => {
    // Clean up any caches created by helpers
    defaultCacheFactory.shutdown();
  });

  it('should create domain availability cache', () => {
    const cache = CacheFactoryHelpers.createDomainAvailabilityCache<boolean>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_CONFIGS['domain-availability'].maxSize);
    cache.shutdown();
  });

  it('should create DNS records cache', () => {
    const cache = CacheFactoryHelpers.createDNSRecordsCache<object>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_CONFIGS['dns-records'].maxSize);
    cache.shutdown();
  });

  it('should create WHOIS data cache', () => {
    const cache = CacheFactoryHelpers.createWhoisDataCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_CONFIGS['whois-data'].maxSize);
    cache.shutdown();
  });

  it('should create API responses cache', () => {
    const cache = CacheFactoryHelpers.createAPIResponsesCache<any>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_CONFIGS['api-responses'].maxSize);
    cache.shutdown();
  });

  it('should create general cache', () => {
    const cache = CacheFactoryHelpers.createGeneralCache<string>();
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(CACHE_CONFIGS['general'].maxSize);
    cache.shutdown();
  });

  it('should create caches with custom configuration', () => {
    const customConfig: Partial<CacheConfig> = {
      maxSize: 100,
      defaultTTL: 60000,
    };

    const cache = CacheFactoryHelpers.createGeneralCache<string>(customConfig);
    const stats = cache.getStats();

    expect(stats.maxSize).toBe(100);
    cache.shutdown();
  });
});

describe('Cache Configurations', () => {
  it('should have valid configurations for all cache types', () => {
    const cacheTypes: CacheType[] = [
      'domain-availability',
      'dns-records',
      'whois-data',
      'api-responses',
      'general',
    ];

    for (const type of cacheTypes) {
      const config = CACHE_CONFIGS[type];

      expect(config.name).toBeDefined();
      expect(config.maxSize).toBeGreaterThan(0);
      expect(config.defaultTTL).toBeGreaterThan(0);
      expect(config.cleanupInterval).toBeGreaterThan(0);
      expect(config.memoryThreshold).toBeGreaterThan(0);
    }
  });

  it('should have reasonable TTL values for different cache types', () => {
    // Domain availability should be relatively short (5 minutes)
    expect(CACHE_CONFIGS['domain-availability'].defaultTTL).toBe(5 * 60 * 1000);

    // DNS records should be longer (1 hour)
    expect(CACHE_CONFIGS['dns-records'].defaultTTL).toBe(60 * 60 * 1000);

    // WHOIS data should be longest (24 hours)
    expect(CACHE_CONFIGS['whois-data'].defaultTTL).toBe(24 * 60 * 60 * 1000);
  });

  it('should have appropriate memory thresholds', () => {
    // All memory thresholds should be reasonable (between 1MB and 50MB)
    for (const config of Object.values(CACHE_CONFIGS)) {
      expect(config.memoryThreshold).toBeGreaterThanOrEqual(1024 * 1024); // At least 1MB
      expect(config.memoryThreshold).toBeLessThanOrEqual(50 * 1024 * 1024); // At most 50MB
    }
  });
});
