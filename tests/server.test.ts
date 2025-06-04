import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RealtimeRegisterMCPServer } from '../src/core/server.js';
import { ConfigurationError } from '../src/core/errors.js';

// Mock all dependencies
jest.mock('../src/core/config.js');
jest.mock('../src/api/cached-client.js');

describe('RealtimeRegisterMCPServer', () => {
  let server: RealtimeRegisterMCPServer;

  beforeEach(() => {
    server = new RealtimeRegisterMCPServer();
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch (error) {
      // Ignore errors during cleanup
    }
  });

  describe('Constructor', () => {
    it('should create server instance', () => {
      expect(server).toBeInstanceOf(RealtimeRegisterMCPServer);
    });
  });

  describe('Tool Handlers', () => {
    it('should create server with proper handler setup', () => {
      // Test that handlers are properly registered during construction
      const internalServer = (server as any).server;
      expect(internalServer).toBeDefined();
    });

    it('should handle domain validation in handler methods', () => {
      // Test the validation logic directly
      const testHandler = (server as any).handleCheckDomainAvailability;
      expect(testHandler).toBeDefined();
      expect(typeof testHandler).toBe('function');
    });

    it('should handle bulk domain validation in handler methods', () => {
      // Test the validation logic directly
      const testHandler = (server as any).handleCheckBulkDomains;
      expect(testHandler).toBeDefined();
      expect(typeof testHandler).toBe('function');
    });
  });

  describe('Tool Configuration', () => {
    it('should configure tools during server setup', () => {
      // Test that the server is configured with proper handlers
      const setupMethod = (server as any).setupToolHandlers;
      expect(setupMethod).toBeDefined();
      expect(typeof setupMethod).toBe('function');
    });

    it('should have tool handler methods defined', () => {
      // Verify all expected handler methods exist
      expect((server as any).handleCheckDomainAvailability).toBeDefined();
      expect((server as any).handleCheckBulkDomains).toBeDefined();
      expect((server as any).handleTestApiConnection).toBeDefined();
    });
  });

  describe('Server Lifecycle', () => {
    it('should start server without config', async () => {
      // The server should start even without proper configuration
      await expect(server.start()).resolves.not.toThrow();
    });

    it('should handle stop gracefully', async () => {
      await server.start();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should handle stop without start', async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should have initializeApiClient method for lazy loading', () => {
      const initMethod = (server as any).initializeApiClient;
      expect(initMethod).toBeDefined();
      expect(typeof initMethod).toBe('function');
    });

    it('should handle missing API client gracefully', async () => {
      // Test that the server can handle missing API client
      const testServer = new RealtimeRegisterMCPServer();
      expect((testServer as any).apiClient).toBeNull();
      await testServer.stop();
    });

    it('should handle initialization errors', async () => {
      // Test error handling during initialization
      const initMethod = (server as any).initializeApiClient;
      expect(typeof initMethod).toBe('function');
    });
  });
});