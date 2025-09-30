/**
 * Test server price formatting logic
 */

import { RealtimeRegisterMCPServer } from '../src/core/server.js';

// Mock the SDK
jest.mock('@realtimeregister/api', () => {
  const mockCheck = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      domains: {
        check: mockCheck,
      },
    })),
    DomainApi: jest.fn(),
  };
});

describe('Server Price Formatting', () => {
  let server: RealtimeRegisterMCPServer;
  let mockSdk: any;

  beforeEach(() => {
    server = new RealtimeRegisterMCPServer();
    
    // Get access to the mock SDK
    const RealtimeRegisterAPI = require('@realtimeregister/api').default;
    mockSdk = new RealtimeRegisterAPI();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should format premium domain price correctly', async () => {
    // Mock SDK response with premium domain price
    mockSdk.domains.check.mockResolvedValue({
      available: true,
      price: 54500, // This will be converted to 545.00 by client
      currency: 'USD',
      premium: true,
    });

    const result = await server['handleCheckDomainAvailability']({ domain: 'fairy.blog' });

    expect(result.content[0].text).toContain('$545.00');
    expect(result.content[0].text).toContain('(Premium)');
    expect(result.content[0].text).toContain('✅ Available');
  });

  test('should format regular domain price correctly', async () => {
    // Mock SDK response with regular domain price
    mockSdk.domains.check.mockResolvedValue({
      available: true,
      price: 1000, // This will be converted to 10.00 by client
      currency: 'USD',
    });

    const result = await server['handleCheckDomainAvailability']({ domain: 'example.com' });

    expect(result.content[0].text).toContain('$10.00');
    expect(result.content[0].text).not.toContain('(Premium)');
    expect(result.content[0].text).toContain('✅ Available');
  });

  test('should handle unavailable domain without pricing', async () => {
    // Mock SDK response for unavailable domain
    mockSdk.domains.check.mockResolvedValue({
      available: false,
      reason: 'Domain is already registered',
    });

    const result = await server['handleCheckDomainAvailability']({ domain: 'google.com' });

    expect(result.content[0].text).not.toContain('Price:');
    expect(result.content[0].text).toContain('❌ Not Available');
    expect(result.content[0].text).toContain('Domain is already registered');
  });
});