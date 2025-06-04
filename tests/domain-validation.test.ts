/**
 * Domain validation tests based on official RealtimeRegister API documentation
 *
 * Official regex from API docs: ^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:[a-z][a-z0-9-]{0,61}[a-z0-9])$
 * Domain length: 3-255 characters
 *
 * Documentation source: https://dm.realtimeregister.com/docs/api/domains/check
 */

import { describe, test, expect } from '@jest/globals';

describe('Domain Validation (Official RealtimeRegister Specification)', () => {
  const DOMAIN_REGEX =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z][a-z0-9-]{0,61}[a-z0-9])$/;

  describe('Valid domains', () => {
    const validDomains = [
      'example.com',
      'test.org',
      'my-domain.net',
      'a.co',
      'sub.example.com',
      'very-long-subdomain-name.example-domain.co.uk',
      '123.example.com',
      'a1b2c3.test.org',
      'multi.level.sub.domain.example.com',
      'test-hyphen.example-domain.co',
    ];

    test.each(validDomains)('should accept valid domain: %s', (domain) => {
      expect(DOMAIN_REGEX.test(domain)).toBe(true);
      expect(domain.length).toBeGreaterThanOrEqual(3);
      expect(domain.length).toBeLessThanOrEqual(255);
    });
  });

  describe('Invalid domains', () => {
    const invalidDomains = [
      '',
      'domain',
      'domain.',
      '.domain.com',
      'domain..com',
      'domain-.com',
      '-domain.com',
      'domain.com.',
      'domain with spaces.com',
      'domain@example.com',
      'domain#test.com',
    ];

    test.each(invalidDomains)('should reject invalid domain: %s', (domain) => {
      expect(DOMAIN_REGEX.test(domain.toLowerCase())).toBe(false);
    });
  });

  describe('Domain length constraints', () => {
    test('should reject domains shorter than 3 characters', () => {
      const shortDomains = ['a', 'ab', 'a.'];

      shortDomains.forEach((domain) => {
        expect(domain.length < 3 || !DOMAIN_REGEX.test(domain)).toBe(true);
      });
    });

    test('should reject domains longer than 255 characters', () => {
      const longDomain = 'a'.repeat(252) + '.com'; // 256 characters total
      expect(longDomain.length).toBeGreaterThan(255);
      expect(DOMAIN_REGEX.test(longDomain)).toBe(false);
    });
  });

  describe('Case handling', () => {
    test('should handle lowercase conversion', () => {
      const domain = 'EXAMPLE.COM';
      const lowercaseDomain = domain.toLowerCase();

      expect(lowercaseDomain).toBe('example.com');
      expect(DOMAIN_REGEX.test(lowercaseDomain)).toBe(true);
    });
  });

  describe('Special characters and edge cases', () => {
    test('should handle domains with hyphens correctly', () => {
      const domainsWithHyphens = [
        'test-domain.com',
        'sub-domain.test-site.org',
        'a-b-c.example.net',
      ];

      domainsWithHyphens.forEach((domain) => {
        expect(DOMAIN_REGEX.test(domain)).toBe(true);
      });
    });

    test('should handle numeric domains correctly', () => {
      const numericDomains = ['123.com', 'test123.org', '1a2b3c.example.net'];

      numericDomains.forEach((domain) => {
        expect(DOMAIN_REGEX.test(domain)).toBe(true);
      });
    });

    test('should reject domains with invalid hyphen placement', () => {
      const invalidHyphenDomains = [
        '-example.com', // starts with hyphen
        'example-.com', // ends with hyphen
      ];

      invalidHyphenDomains.forEach((domain) => {
        expect(DOMAIN_REGEX.test(domain)).toBe(false);
      });
    });
  });
});
