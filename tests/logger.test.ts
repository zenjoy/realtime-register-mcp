/**
 * Tests for the logger functionality
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger, FileLogger } from '../src/core/logger';

describe('Logger', () => {
  const testLogFile = join(process.cwd(), 'mcp-server.log');

  beforeEach(() => {
    // Clean up any existing log file
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
  });

  afterEach(() => {
    // Clean up log file after each test
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
  });

  describe('File logging opt-in behavior', () => {
    test('should not create log file by default', () => {
      const logger = createLogger('info');

      // Log something
      logger.info('Test message');

      // File should not exist
      expect(existsSync(testLogFile)).toBe(false);
    });

    test('should not create log file when explicitly disabled', () => {
      const logger = createLogger('info', false);

      // Log something
      logger.info('Test message');

      // File should not exist
      expect(existsSync(testLogFile)).toBe(false);
    });

    test('should create log file when explicitly enabled', () => {
      const logger = createLogger('info', true);

      // File should exist after logger creation
      expect(existsSync(testLogFile)).toBe(true);

      // Should contain startup message
      const content = readFileSync(testLogFile, 'utf-8');
      expect(content).toContain('=== MCP Server Started at');
    });

    test('should write logs to file when file logging is enabled', () => {
      const logger = createLogger('info', true);

      // Log a test message
      logger.info('Test log message', { key: 'value' });

      // Read file content
      const content = readFileSync(testLogFile, 'utf-8');
      expect(content).toContain('[INFO] [RealtimeRegister] Test log message');
      expect(content).toContain('{"key":"value"}');
    });

    test('should respect log levels when file logging is enabled', () => {
      const logger = createLogger('warn', true);

      // Log messages at different levels
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      // Read file content
      const content = readFileSync(testLogFile, 'utf-8');
      expect(content).not.toContain('Debug message');
      expect(content).not.toContain('Info message');
      expect(content).toContain('Warn message');
      expect(content).toContain('Error message');
    });
  });

  describe('FileLogger direct instantiation', () => {
    test('should not create log file by default', () => {
      new FileLogger('info');

      expect(existsSync(testLogFile)).toBe(false);
    });

    test('should create log file when enabled', () => {
      new FileLogger('info', true);

      expect(existsSync(testLogFile)).toBe(true);
    });
  });
});
