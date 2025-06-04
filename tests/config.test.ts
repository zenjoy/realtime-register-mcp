/**
 * Tests for configuration loading and validation
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Config, loadConfig, validateConfig } from '../src/core/config';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment after each test
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    test('should load configuration with test environment defaults', () => {
      // Test environment has REALTIME_REGISTER_API_KEY=test-api-key set in setup.js
      // and REALTIME_REGISTER_BASE_URL=https://api.yoursrs-ote.com
      const config = loadConfig();

      expect(config.apiKey).toBe('test-api-key');
      expect(config.baseUrl).toBe('https://api.yoursrs-ote.com'); // Test environment URL
      expect(config.requestTimeout).toBe(30000);
      expect(config.debug).toBe(false);
      expect(config.logLevel).toBe('debug'); // Set in test setup
      expect(config.serverName).toBe('realtime-register-mcp');
      expect(config.serverVersion).toMatch(/^\d+\.\d+\.\d+/); // Should match semver pattern
    });

    test('should override with custom environment variables', () => {
      process.env.REALTIME_REGISTER_API_KEY = 'custom-key';
      process.env.REALTIME_REGISTER_BASE_URL = 'https://custom.example.com';
      process.env.REALTIME_REGISTER_TIMEOUT = '60000';
      process.env.REALTIME_REGISTER_DEBUG = 'true';
      process.env.LOG_LEVEL = 'error';

      const config = loadConfig();

      expect(config.apiKey).toBe('custom-key');
      expect(config.baseUrl).toBe('https://custom.example.com');
      expect(config.requestTimeout).toBe(60000);
      expect(config.debug).toBe(true);
      expect(config.logLevel).toBe('error');
    });

    test('should handle invalid timeout gracefully', () => {
      process.env.REALTIME_REGISTER_TIMEOUT = 'invalid';

      const config = loadConfig();

      expect(config.requestTimeout).toBe(30000); // Should fallback to default
    });

    test('should read server name and version from package.json', () => {
      const config = loadConfig();

      expect(config.serverName).toBe('realtime-register-mcp');
      expect(config.serverVersion).toMatch(/^\d+\.\d+\.\d+/); // Should be a valid semver
    });
  });

  describe('validateConfig', () => {
    test('should validate a complete config', () => {
      const config: Config = {
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        requestTimeout: 30000,
        debug: false,
        logLevel: 'info',
        serverName: 'test-server',
        serverVersion: '1.0.0',
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    test('should throw for missing API key', () => {
      const config: Config = {
        apiKey: '',
        baseUrl: 'https://api.example.com',
        requestTimeout: 30000,
        debug: false,
        logLevel: 'info',
        serverName: 'test-server',
        serverVersion: '1.0.0',
      };

      expect(() => validateConfig(config)).toThrow('API key is required');
    });

    test('should throw for invalid timeout', () => {
      const config: Config = {
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        requestTimeout: -1,
        debug: false,
        logLevel: 'info',
        serverName: 'test-server',
        serverVersion: '1.0.0',
      };

      expect(() => validateConfig(config)).toThrow('Request timeout must be positive');
    });
  });

  describe('Config interface compliance', () => {
    test('should have all required properties', () => {
      process.env.REALTIME_REGISTER_API_KEY = 'test-key';
      const config = loadConfig();

      expect(config).toHaveProperty('apiKey');
      expect(config).toHaveProperty('baseUrl');
      expect(config).toHaveProperty('requestTimeout');
      expect(config).toHaveProperty('debug');
      expect(config).toHaveProperty('logLevel');
      expect(config).toHaveProperty('serverName');
      expect(config).toHaveProperty('serverVersion');
    });

    test('should have correct property types', () => {
      process.env.REALTIME_REGISTER_API_KEY = 'test-key';
      const config = loadConfig();

      expect(typeof config.apiKey).toBe('string');
      expect(typeof config.baseUrl).toBe('string');
      expect(typeof config.requestTimeout).toBe('number');
      expect(typeof config.debug).toBe('boolean');
      expect(typeof config.logLevel).toBe('string');
      expect(typeof config.serverName).toBe('string');
      expect(typeof config.serverVersion).toBe('string');
    });
  });
});
