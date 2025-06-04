import { describe, it, expect } from '@jest/globals';
import {
  RealtimeRegisterMCPError,
  ConfigurationError,
  ValidationError,
  ApiError,
  NetworkError,
  MCPError,
} from '../src/core/errors.js';

describe('Error Classes', () => {
  describe('RealtimeRegisterMCPError', () => {
    it('should create base error with message and code', () => {
      class TestError extends RealtimeRegisterMCPError {
        readonly code = 'TEST_ERROR';
        constructor(message: string, cause?: Error) {
          super(message, cause);
        }
      }

      const error = new TestError('Test message');
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('TestError');
    });

    it('should chain errors with cause', () => {
      class TestError extends RealtimeRegisterMCPError {
        readonly code = 'TEST_ERROR';
        constructor(message: string, cause?: Error) {
          super(message, cause);
        }
      }

      const cause = new Error('Original error');
      const error = new TestError('Wrapped error', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('ConfigurationError', () => {
    it('should create configuration error', () => {
      const error = new ConfigurationError('Config missing');
      expect(error.message).toBe('Configuration error: Config missing');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.name).toBe('ConfigurationError');
    });

    it('should create configuration error with cause', () => {
      const cause = new Error('File not found');
      const error = new ConfigurationError('Config file error', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid domain', 'domain');
      expect(error.message).toBe('Validation error: Invalid domain');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('domain');
    });

    it('should create validation error with cause', () => {
      const cause = new Error('Type error');
      const error = new ValidationError('Type validation failed', 'type', cause);
      expect(error.cause).toBe(cause);
      expect(error.field).toBe('type');
    });
  });

  describe('ApiError', () => {
    it('should create API error', () => {
      const error = new ApiError('API failed', 500, 'Internal Server Error');
      expect(error.message).toBe('API error (500 Internal Server Error): API failed');
      expect(error.code).toBe('API_ERROR');
      expect(error.status).toBe(500);
      expect(error.statusText).toBe('Internal Server Error');
    });

    it('should create API error with cause', () => {
      const cause = new Error('Network timeout');
      const error = new ApiError('Request timeout', 408, 'Request Timeout', undefined, cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('NetworkError', () => {
    it('should create network error', () => {
      const error = new NetworkError('Connection failed');
      expect(error.message).toBe('Network error: Connection failed');
      expect(error.code).toBe('NETWORK_ERROR');
    });

    it('should create network error with cause', () => {
      const cause = new Error('DNS resolution failed');
      const error = new NetworkError('DNS error', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('MCPError', () => {
    it('should create MCP error', () => {
      const error = new MCPError('MCP tool failed', 'check_domain');
      expect(error.message).toBe('MCP error: MCP tool failed');
      expect(error.code).toBe('MCP_ERROR');
      expect(error.toolName).toBe('check_domain');
    });

    it('should create MCP error with cause', () => {
      const cause = new Error('Tool execution failed');
      const error = new MCPError('Tool error', 'bulk_check', cause);
      expect(error.cause).toBe(cause);
      expect(error.toolName).toBe('bulk_check');
    });
  });
});