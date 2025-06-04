/**
 * Jest test setup file
 * This file runs before each test suite
 */

// Jest setup file
// This file is executed before running tests

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'debug';
process.env.REALTIME_REGISTER_API_KEY = 'test-api-key';
process.env.REALTIME_REGISTER_BASE_URL = 'https://api.yoursrs-ote.com';

// Global test timeout
jest.setTimeout(10000);

// Setup fetch mock
require('jest-fetch-mock').enableMocks();

// Mock console methods to avoid noise in test output
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  // Keep error and warn for debugging test failures
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
};
