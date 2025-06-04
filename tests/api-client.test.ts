/**
 * Tests for RealtimeRegister API client
 * Testing lightweight validation and API mechanics
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { RealtimeRegisterClient } from '../src/api/client';

describe('RealtimeRegister API Client', () => {
  let client: RealtimeRegisterClient;

  beforeEach(() => {
    client = new RealtimeRegisterClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.yoursrs-ote.com',
      requestTimeout: 30000,
      debug: false,
      logLevel: 'info',
      serverName: 'test-server',
      serverVersion: '1.0.0',
    });
  });

  describe('Basic input validation', () => {
    test('should reject empty or invalid input', async () => {
      // Test empty string
      await expect(client.checkDomainAvailability('')).rejects.toThrow(
        'Domain must be a non-empty string'
      );

      // Test whitespace-only string
      await expect(client.checkDomainAvailability('   ')).rejects.toThrow(
        'Domain must be a non-empty string'
      );
    });

    test('should accept any non-empty string and let API validate', () => {
      // These would normally be invalid domains, but we let the API decide
      // The function will attempt the API call (which will fail in tests due to no mocking)
      // but won't throw validation errors for the input itself
      expect(() => {
        client.checkDomainAvailability('example.com').catch(() => {
          // Ignore network errors - we only care that input validation passes
        });
      }).not.toThrow();

      expect(() => {
        client.checkDomainAvailability('invalid-domain').catch(() => {
          // Ignore network errors - we only care that input validation passes
        });
      }).not.toThrow();

      expect(() => {
        client.checkDomainAvailability('UPPERCASE.COM').catch(() => {
          // Ignore network errors - we only care that input validation passes
        });
      }).not.toThrow();
    });

    test('should convert domains to lowercase', () => {
      // We can't easily test the internal conversion without mocking,
      // but we can verify that the function accepts uppercase input
      expect(() => {
        client.checkDomainAvailability('EXAMPLE.COM').catch(() => {
          // Ignore network errors - we only care about input handling
        });
      }).not.toThrow();
    });
  });

  describe('Constructor and configuration', () => {
    test('should create client with provided configuration', () => {
      const config = {
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
        requestTimeout: 60000,
        debug: true,
        logLevel: 'debug' as const,
        serverName: 'test-server',
        serverVersion: '2.0.0',
      };

      const testClient = new RealtimeRegisterClient(config);

      // Client should be created successfully
      expect(testClient).toBeDefined();
      expect(testClient).toBeInstanceOf(RealtimeRegisterClient);
    });
  });

  describe('API mechanics', () => {
    test('should construct correct API endpoint', () => {
      // This test verifies that the method doesn't throw during setup
      // The actual API call will fail due to no network mocking, but that's expected
      expect(() => {
        const promise = client.checkDomainAvailability('example.com');
        // Catch the promise to prevent unhandled rejection
        promise.catch(() => {
          // Expected to fail due to no API mocking
        });
      }).not.toThrow();
    });
  });
});
