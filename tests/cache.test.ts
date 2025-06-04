import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { LRUCache, createCache, CacheOptions } from '../src/cache';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>({
      maxSize: 3,
      defaultTTL: 1000, // 1 second for testing
      cleanupInterval: 100, // 100ms for testing
    });
  });

  afterEach(() => {
    cache.shutdown();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should check if keys exist', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should return correct size', () => {
      expect(cache.size()).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });

    it('should return all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const keys = cache.keys();
      expect(keys).toEqual(['key1', 'key2']);
    });
  });

  describe('TTL Functionality', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      expect(cache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(cache.get('key1')).toBeNull();
    });

    it('should use default TTL when not specified', async () => {
      cache.set('key1', 'value1'); // Should use 1000ms default
      expect(cache.get('key1')).toBe('value1');

      // Should still be valid after 100ms
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(cache.get('key1')).toBe('value1');
    });

    it('should remove expired entries on has() check', async () => {
      cache.set('key1', 'value1', 50);
      expect(cache.has('key1')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(cache.has('key1')).toBe(false);
      expect(cache.size()).toBe(0);
    });

    it('should allow setting different TTLs for different keys', async () => {
      cache.set('short', 'value1', 50);
      cache.set('long', 'value2', 200);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(cache.get('short')).toBeNull();
      expect(cache.get('long')).toBe('value2');

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(cache.get('long')).toBeNull();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used item when at capacity', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);

      // Adding fourth item should evict key1
      cache.set('key4', 'value4');
      expect(cache.size()).toBe(3);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should update LRU order on access', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Adding fourth item should evict key2 (now least recently used)
      cache.set('key4', 'value4');
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should not evict when updating existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update existing key
      cache.set('key2', 'newvalue2');
      expect(cache.size()).toBe(3);
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('newvalue2');
      expect(cache.get('key3')).toBe('value3');
    });
  });

  describe('Metrics and Statistics', () => {
    it('should track cache hits and misses', () => {
      cache.set('key1', 'value1');

      // Hit
      cache.get('key1');
      // Miss
      cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should track evictions', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should cause eviction

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should reset metrics on clear', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('nonexistent');

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.clear();
      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
    });

    it('should return correct size and maxSize in stats', () => {
      cache.set('key1', 'value1');
      const stats = cache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(3);
    });

    it('should calculate hit rate correctly', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0); // No operations yet

      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const newStats = cache.getStats();
      expect(newStats.hitRate).toBe(2 / 3); // 2 hits, 1 miss
    });
  });

  describe('Cleanup Functionality', () => {
    it('should manually cleanup expired entries', async () => {
      cache.set('key1', 'value1', 50);
      cache.set('key2', 'value2', 200);

      await new Promise((resolve) => setTimeout(resolve, 60));

      const cleanedUp = cache.cleanup();
      expect(cleanedUp).toBe(1);
      expect(cache.size()).toBe(1);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should return zero when no cleanup needed', () => {
      cache.set('key1', 'value1');
      const cleanedUp = cache.cleanup();
      expect(cleanedUp).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle setting same key multiple times', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      cache.set('key1', 'value3');

      expect(cache.get('key1')).toBe('value3');
      expect(cache.size()).toBe(1);
    });

    it('should handle empty string keys and values', () => {
      cache.set('', '');
      expect(cache.get('')).toBe('');
      expect(cache.has('')).toBe(true);
    });

    it('should handle zero TTL', () => {
      cache.set('key1', 'value1', 0);
      expect(cache.get('key1')).toBeNull();
    });

    it('should handle negative TTL', () => {
      cache.set('key1', 'value1', -100);
      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('Construction Options', () => {
    it('should use default options when none provided', () => {
      const defaultCache = new LRUCache<string>();
      const stats = defaultCache.getStats();
      expect(stats.maxSize).toBe(1000);
      defaultCache.shutdown();
    });

    it('should respect custom maxSize', () => {
      const smallCache = new LRUCache<string>({ maxSize: 2 });
      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3'); // Should evict key1

      expect(smallCache.size()).toBe(2);
      expect(smallCache.get('key1')).toBeNull();
      smallCache.shutdown();
    });

    it('should respect custom default TTL', async () => {
      const shortTTLCache = new LRUCache<string>({ defaultTTL: 50 });
      shortTTLCache.set('key1', 'value1');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(shortTTLCache.get('key1')).toBeNull();
      shortTTLCache.shutdown();
    });
  });

  describe('Generic Type Support', () => {
    it('should work with numbers', () => {
      const numCache = new LRUCache<number>({ maxSize: 2 });
      numCache.set('key1', 42);
      numCache.set('key2', 3.14);

      expect(numCache.get('key1')).toBe(42);
      expect(numCache.get('key2')).toBe(3.14);
      numCache.shutdown();
    });

    it('should work with objects', () => {
      interface TestObject {
        name: string;
        value: number;
      }

      const objCache = new LRUCache<TestObject>({ maxSize: 2 });
      const obj1 = { name: 'test1', value: 1 };
      const obj2 = { name: 'test2', value: 2 };

      objCache.set('key1', obj1);
      objCache.set('key2', obj2);

      expect(objCache.get('key1')).toEqual(obj1);
      expect(objCache.get('key2')).toEqual(obj2);
      objCache.shutdown();
    });
  });

  describe('Factory Function', () => {
    it('should create cache instance with createCache function', () => {
      const factoryCache = createCache<string>({ maxSize: 5 });
      factoryCache.set('key1', 'value1');
      expect(factoryCache.get('key1')).toBe('value1');
      expect(factoryCache.getStats().maxSize).toBe(5);
      factoryCache.shutdown();
    });

    it('should create cache with default options when none provided', () => {
      const defaultFactoryCache = createCache<string>();
      expect(defaultFactoryCache.getStats().maxSize).toBe(1000);
      defaultFactoryCache.shutdown();
    });
  });

  describe('Memory Management and Metrics', () => {
    let memoryCache: LRUCache<string>;

    beforeEach(() => {
      memoryCache = new LRUCache<string>({
        maxSize: 5,
        memoryThreshold: 1000, // 1KB threshold
        enableDebugLogging: false, // Keep tests quiet
      });
    });

    afterEach(() => {
      memoryCache.shutdown();
    });

    it('should track memory usage', () => {
      memoryCache.set('key1', 'value1');
      const stats = memoryCache.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.memoryThreshold).toBe(1000);
    });

    it('should include cleanup count in stats', async () => {
      memoryCache.set('key1', 'value1', 50);
      memoryCache.set('key2', 'value2', 50);

      const initialStats = memoryCache.getStats();
      expect(initialStats.cleanups).toBe(0);

      // Wait for expiration then trigger cleanup
      await new Promise((resolve) => setTimeout(resolve, 60));

      memoryCache.cleanup();
      const afterStats = memoryCache.getStats();
      expect(afterStats.cleanups).toBeGreaterThan(initialStats.cleanups);
    });

    it('should update memory usage when deleting entries', () => {
      memoryCache.set('key1', 'large_value_that_takes_memory');
      const beforeDelete = memoryCache.getStats().memoryUsage;

      memoryCache.delete('key1');
      const afterDelete = memoryCache.getStats().memoryUsage;

      expect(afterDelete).toBeLessThan(beforeDelete);
    });

    it('should reset memory usage when clearing cache', () => {
      memoryCache.set('key1', 'value1');
      memoryCache.set('key2', 'value2');

      const beforeClear = memoryCache.getStats().memoryUsage;
      expect(beforeClear).toBeGreaterThan(0);

      memoryCache.clear();
      const afterClear = memoryCache.getStats().memoryUsage;
      expect(afterClear).toBe(0);
    });

    it('should track memory usage with different data types', () => {
      const numCache = new LRUCache<number>({ maxSize: 3 });
      const objCache = new LRUCache<object>({ maxSize: 3 });

      numCache.set('num', 42);
      objCache.set('obj', { name: 'test', value: 123 });

      const numStats = numCache.getStats();
      const objStats = objCache.getStats();

      expect(numStats.memoryUsage).toBeGreaterThan(0);
      expect(objStats.memoryUsage).toBeGreaterThan(0);
      // Object should generally use more memory than number
      expect(objStats.memoryUsage).toBeGreaterThan(numStats.memoryUsage);

      numCache.shutdown();
      objCache.shutdown();
    });
  });

  describe('Debug Logging', () => {
    it('should create cache with debug logging enabled', () => {
      const debugCache = new LRUCache<string>({
        maxSize: 2,
        enableDebugLogging: true,
      });

      // Should not throw errors with debug logging enabled
      debugCache.set('key1', 'value1');
      debugCache.get('key1');
      debugCache.get('nonexistent');
      debugCache.delete('key1');

      debugCache.shutdown();
    });

    it('should create cache with debug logging disabled', () => {
      const quietCache = new LRUCache<string>({
        maxSize: 2,
        enableDebugLogging: false,
      });

      // Should work normally with debug logging disabled
      quietCache.set('key1', 'value1');
      expect(quietCache.get('key1')).toBe('value1');

      quietCache.shutdown();
    });
  });
});
