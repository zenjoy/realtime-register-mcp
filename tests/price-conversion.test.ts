/**
 * Test price conversion from cents to dollars
 */

import { RealtimeRegisterClient } from '../src/api/client.js';
import { loadConfig } from '../src/core/config.js';

describe('Price Conversion', () => {
  let client: RealtimeRegisterClient;

  beforeEach(() => {
    const config = loadConfig();
    client = new RealtimeRegisterClient(config);
    
    // Reset fetch mock
    fetchMock.resetMocks();
  });

  test('should convert price from cents to dollars', async () => {
    // Mock API response with price in cents (54500 cents = $545.00)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        price: 54500, // Price in cents
        currency: 'USD',
        premium: true,
      }),
    } as any);

    const result = await client.checkDomainAvailability('fairy.blog');

    expect(result.price).toBe(545.00); // Should be converted to dollars
    expect(result.currency).toBe('USD');
    expect(result.available).toBe(true);
  });

  test('should handle regular domain pricing', async () => {
    // Mock API response with regular domain price (1500 cents = $15.00)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        price: 1500, // Price in cents  
        currency: 'USD',
      }),
    } as any);

    const result = await client.checkDomainAvailability('example.com');

    expect(result.price).toBe(15.00); // Should be converted to dollars
    expect(result.currency).toBe('USD');
    expect(result.available).toBe(true);
  });

  test('should handle domains without pricing', async () => {
    // Mock API response without pricing info
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: false,
        reason: 'Domain is already registered',
      }),
    } as any);

    const result = await client.checkDomainAvailability('google.com');

    expect(result.price).toBeUndefined();
    expect(result.currency).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.reason).toBe('Domain is already registered');
  });
});