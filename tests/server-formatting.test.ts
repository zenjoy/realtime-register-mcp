/**
 * Test server price formatting logic
 */

import { RealtimeRegisterMCPServer } from '../src/core/server.js';

describe('Server Price Formatting', () => {
  let server: RealtimeRegisterMCPServer;

  beforeEach(() => {
    server = new RealtimeRegisterMCPServer();
    
    // Reset fetch mock
    fetchMock.resetMocks();
  });

  test('should format premium domain price correctly', async () => {
    // Mock API response with premium domain price (already converted to dollars)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        price: 54500, // This will be converted to 545.00 by client
        currency: 'USD',
        premium: true,
      }),
    } as any);

    const result = await server['handleCheckDomainAvailability']({ domain: 'fairy.blog' });

    expect(result.content[0].text).toContain('$545.00');
    expect(result.content[0].text).toContain('(Premium)');
    expect(result.content[0].text).toContain('✅ Available');
  });

  test('should format regular domain price correctly', async () => {
    // Mock API response with regular domain price
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: true,
        price: 1000, // This will be converted to 10.00 by client
        currency: 'USD',
      }),
    } as any);

    const result = await server['handleCheckDomainAvailability']({ domain: 'example.com' });

    expect(result.content[0].text).toContain('$10.00');
    expect(result.content[0].text).not.toContain('(Premium)');
    expect(result.content[0].text).toContain('✅ Available');
  });

  test('should handle unavailable domain without pricing', async () => {
    // Mock API response for unavailable domain
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        available: false,
        reason: 'Domain is already registered',
      }),
    } as any);

    const result = await server['handleCheckDomainAvailability']({ domain: 'google.com' });

    expect(result.content[0].text).not.toContain('Price:');
    expect(result.content[0].text).toContain('❌ Not Available');
    expect(result.content[0].text).toContain('Domain is already registered');
  });
});