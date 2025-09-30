/**
 * Test price conversion from cents to dollars
 */

import { RealtimeRegisterClient } from '../src/api/client.js';
import { loadConfig } from '../src/core/config.js';

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

describe('Price Conversion', () => {
  let client: RealtimeRegisterClient;
  let mockSdk: any;

  beforeEach(() => {
    const config = loadConfig();
    client = new RealtimeRegisterClient(config);
    
    // Get access to the mock SDK
    const RealtimeRegisterAPI = require('@realtimeregister/api').default;
    mockSdk = new RealtimeRegisterAPI();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should convert price from cents to dollars', async () => {
    // Mock SDK response with price in cents (54500 cents = $545.00)
    mockSdk.domains.check.mockResolvedValue({
      available: true,
      price: 54500, // Price in cents
      currency: 'USD',
      premium: true,
    });

    const result = await client.checkDomainAvailability('fairy.blog');

    expect(result.price).toBe(545.00); // Should be converted to dollars
    expect(result.currency).toBe('USD');
    expect(result.available).toBe(true);
  });

  test('should handle regular domain pricing', async () => {
    // Mock SDK response with regular domain price (1500 cents = $15.00)
    mockSdk.domains.check.mockResolvedValue({
      available: true,
      price: 1500, // Price in cents  
      currency: 'USD',
    });

    const result = await client.checkDomainAvailability('example.com');

    expect(result.price).toBe(15.00); // Should be converted to dollars
    expect(result.currency).toBe('USD');
    expect(result.available).toBe(true);
  });

  test('should handle domains without pricing', async () => {
    // Mock SDK response without pricing info
    mockSdk.domains.check.mockResolvedValue({
      available: false,
      reason: 'Domain is already registered',
    });

    const result = await client.checkDomainAvailability('google.com');

    expect(result.price).toBeUndefined();
    expect(result.currency).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('Domain is already registered');
  });
});