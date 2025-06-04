import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RealtimeRegisterMCPServer } from '../src/core/server.js';
import { loadConfig } from '../src/core/config.js';
import { DomainAvailabilityResponse } from '../src/api/client.js';

// Mock the config module
jest.mock('../src/core/config.js');
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;

// Mock the cached API client
jest.mock('../src/api/cached-client.js');

describe('Bulk Domain MCP Integration', () => {
  let server: RealtimeRegisterMCPServer;
  let mockApiClient: any;

  beforeEach(() => {
    // Mock configuration
    mockLoadConfig.mockReturnValue({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.realtimeregister.com',
      requestTimeout: 30000,
      debug: false,
      logLevel: 'info',
      serverName: 'realtime-register-mcp',
      serverVersion: '0.1.0',
    });

    // Create mock API client
    mockApiClient = {
      checkDomainAvailability: jest.fn(),
      checkDomainsAvailability: jest.fn(),
      testConnection: jest.fn(),
    };

    server = new RealtimeRegisterMCPServer();

    // Inject mock API client
    (server as any).apiClient = mockApiClient;
    (server as any).config = mockLoadConfig();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCheckBulkDomains', () => {
    it('should validate input parameters correctly', async () => {
      const handler = (server as any).handleCheckBulkDomains.bind(server);

      // Test missing domains parameter
      await expect(handler({})).rejects.toThrow(
        'Domains parameter is required and must be an array'
      );

      // Test non-array domains parameter
      await expect(handler({ domains: 'not-an-array' })).rejects.toThrow(
        'Domains parameter is required and must be an array'
      );

      // Test empty domains array
      await expect(handler({ domains: [] })).rejects.toThrow('Domains array cannot be empty');

      // Test too many domains
      const tooManyDomains = Array(51).fill('example.com');
      await expect(handler({ domains: tooManyDomains })).rejects.toThrow(
        'Domains array cannot contain more than 50 domains per request'
      );

      // Test invalid domain types
      await expect(handler({ domains: ['valid.com', 123, 'another.com'] })).rejects.toThrow(
        'Domain at index 1 must be a non-empty string'
      );

      // Test empty string domains
      await expect(handler({ domains: ['valid.com', '', 'another.com'] })).rejects.toThrow(
        'Domain at index 1 must be a non-empty string'
      );

      // Test whitespace-only domains
      await expect(handler({ domains: ['valid.com', '   ', 'another.com'] })).rejects.toThrow(
        'Domain at index 1 must be a non-empty string'
      );
    });

    it('should normalize domain names correctly', async () => {
      const mockResult = {
        successful: [
          { domain: 'example.com', available: true, price: 10.99, currency: 'USD' },
          { domain: 'test.org', available: false, reason: 'Already registered' },
        ],
        failed: [],
        summary: {
          totalDomains: 2,
          successfulChecks: 2,
          failedChecks: 0,
          cacheHits: 0,
          apiCalls: 2,
          successRate: 100,
        },
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          processingTimeMs: 100,
          chunkCount: 1,
          chunkSize: 50,
        },
      };

      mockApiClient.checkDomainsAvailability.mockResolvedValue(mockResult);

      const handler = (server as any).handleCheckBulkDomains.bind(server);
      const result = await handler({
        domains: ['  EXAMPLE.COM  ', '  Test.ORG  '],
      });

      // Verify that domains were normalized (trimmed and lowercased)
      expect(mockApiClient.checkDomainsAvailability).toHaveBeenCalledWith([
        'example.com',
        'test.org',
      ]);
      expect(result.content[0].text).toContain('example.com');
      expect(result.content[0].text).toContain('test.org');
    });

    it('should handle successful bulk domain checks', async () => {
      const mockResult = {
        successful: [
          { domain: 'available.com', available: true, price: 12.99, currency: 'USD' },
          { domain: 'taken.com', available: false, reason: 'Already registered' },
          { domain: 'premium.com', available: true, price: 999.99, currency: 'USD' },
        ],
        failed: [
          {
            domain: 'invalid-domain',
            error: 'Invalid domain format',
            errorType: 'validation' as const,
          },
        ],
        summary: {
          totalDomains: 4,
          successfulChecks: 3,
          failedChecks: 1,
          cacheHits: 1,
          apiCalls: 3,
          successRate: 75,
        },
        metadata: {
          startTime: new Date('2023-01-01T10:00:00Z'),
          endTime: new Date('2023-01-01T10:00:01Z'),
          processingTimeMs: 1000,
          chunkCount: 1,
          chunkSize: 50,
        },
      };

      mockApiClient.checkDomainsAvailability.mockResolvedValue(mockResult);

      const handler = (server as any).handleCheckBulkDomains.bind(server);
      const result = await handler({
        domains: ['available.com', 'taken.com', 'premium.com', 'invalid-domain'],
      });

      expect(result.content[0].text).toContain('Bulk Domain Availability Check Results');
      expect(result.content[0].text).toContain('Total Domains Checked**: 4');
      expect(result.content[0].text).toContain('Available**: 2');
      expect(result.content[0].text).toContain('Unavailable**: 1');
      expect(result.content[0].text).toContain('Failed Checks**: 1');
      expect(result.content[0].text).toContain('Success Rate**: 75.0%');
      expect(result.content[0].text).toContain('Cache Hits**: 1');
      expect(result.content[0].text).toContain('Processing Time**: 1000ms');

      // Check available domains section
      expect(result.content[0].text).toContain('Available Domains (2)');
      expect(result.content[0].text).toContain('**available.com** - $12.99');
      expect(result.content[0].text).toContain('**premium.com** - $999.99 (Premium)');

      // Check unavailable domains section
      expect(result.content[0].text).toContain('Unavailable Domains (1)');
      expect(result.content[0].text).toContain('**taken.com** - Already registered');

      // Check failed checks section
      expect(result.content[0].text).toContain('Failed Checks (1)');
      expect(result.content[0].text).toContain('**invalid-domain**: Invalid domain format');

      // Check performance details
      expect(result.content[0].text).toContain('Performance Details');
      expect(result.content[0].text).toContain('Chunks Processed**: 1');
      expect(result.content[0].text).toContain('API Calls Made**: 3');
    });

    it('should handle API errors gracefully', async () => {
      const apiError = new Error('API connection failed');
      mockApiClient.checkDomainsAvailability.mockRejectedValue(apiError);

      const handler = (server as any).handleCheckBulkDomains.bind(server);

      await expect(handler({ domains: ['test.com'] })).rejects.toThrow('API connection failed');
    });

    it('should handle empty results correctly', async () => {
      const mockResult = {
        successful: [],
        failed: [],
        summary: {
          totalDomains: 0,
          successfulChecks: 0,
          failedChecks: 0,
          cacheHits: 0,
          apiCalls: 0,
          successRate: 0,
        },
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          processingTimeMs: 0,
          chunkCount: 0,
          chunkSize: 50,
        },
      };

      mockApiClient.checkDomainsAvailability.mockResolvedValue(mockResult);

      const handler = (server as any).handleCheckBulkDomains.bind(server);
      const result = await handler({ domains: ['test.com'] });

      expect(result.content[0].text).toContain('Total Domains Checked**: 0');
      expect(result.content[0].text).toContain('Success Rate**: 0.0%');
      expect(result.content[0].text).toContain('Failed Checks**: 0');
      expect(result.content[0].text).not.toContain('Available Domains');
      expect(result.content[0].text).not.toContain('Unavailable Domains');
      expect(result.content[0].text).not.toContain('## ⚠️ Failed Checks');
    });
  });

  describe('formatBulkDomainResponse', () => {
    it('should format response with all sections when data is present', () => {
      const mockResult = {
        successful: [
          { domain: 'available.com', available: true, price: 10.99, currency: 'USD' },
          { domain: 'taken.com', available: false, reason: 'Already registered' },
        ],
        failed: [
          {
            domain: 'invalid.domain',
            error: 'Invalid format',
            errorType: 'validation' as const,
            errorCode: 'INVALID_FORMAT',
          },
        ],
        summary: {
          totalDomains: 3,
          successfulChecks: 2,
          failedChecks: 1,
          cacheHits: 1,
          apiCalls: 2,
          successRate: 66.7,
        },
        metadata: {
          startTime: new Date('2023-01-01T10:00:00Z'),
          endTime: new Date('2023-01-01T10:00:01Z'),
          processingTimeMs: 1000,
          chunkCount: 1,
          chunkSize: 50,
        },
      };

      const formatter = (server as any).formatBulkDomainResponse.bind(server);
      const result = formatter(mockResult);

      expect(result).toContain('# 🔍 Bulk Domain Availability Check Results');
      expect(result).toContain('## 📊 Summary');
      expect(result).toContain('## ✅ Available Domains (1)');
      expect(result).toContain('## ❌ Unavailable Domains (1)');
      expect(result).toContain('## ⚠️ Failed Checks (1)');
      expect(result).toContain('## 🔧 Performance Details');
      expect(result).toContain('**invalid.domain**: Invalid format (INVALID_FORMAT)');
    });

    it('should handle cache hit percentage calculation correctly', () => {
      const mockResult = {
        successful: [],
        failed: [],
        summary: {
          totalDomains: 10,
          successfulChecks: 0,
          failedChecks: 0,
          cacheHits: 3,
          apiCalls: 7,
          successRate: 0,
        },
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          processingTimeMs: 500,
          chunkCount: 1,
          chunkSize: 50,
        },
      };

      const formatter = (server as any).formatBulkDomainResponse.bind(server);
      const result = formatter(mockResult);

      // Cache hits: 3 / (3 + 7) = 30%
      expect(result).toContain('Cache Hits**: 3 / 10 (30.0%)');
    });

    it('should handle zero cache hits correctly', () => {
      const mockResult = {
        successful: [],
        failed: [],
        summary: {
          totalDomains: 5,
          successfulChecks: 0,
          failedChecks: 0,
          cacheHits: 0,
          apiCalls: 5,
          successRate: 0,
        },
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          processingTimeMs: 200,
          chunkCount: 1,
          chunkSize: 50,
        },
      };

      const formatter = (server as any).formatBulkDomainResponse.bind(server);
      const result = formatter(mockResult);

      expect(result).toContain('Cache Hits**: 0 / 5 (0%)');
    });
  });
});
