/**
 * Configuration management for RealtimeRegister MCP Server
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Default package information used as fallback
 */
const DEFAULT_PACKAGE_INFO = {
  name: 'realtime-register-mcp',
  version: '0.1.0',
} as const;

/**
 * Type for package.json structure
 */
interface PackageJson {
  name?: string;
  version?: string;
}

/**
 * Safely reads package.json to get name and version
 * Uses functional approach with error handling
 */
const getPackageInfo = (): { name: string; version: string } => {
  try {
    const packagePath = join(__dirname, '..', 'package.json');
    const packageContent = readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent) as PackageJson;

    return {
      name: packageJson.name ?? DEFAULT_PACKAGE_INFO.name,
      version: packageJson.version ?? DEFAULT_PACKAGE_INFO.version,
    };
  } catch {
    // Return fallback on any error
    return DEFAULT_PACKAGE_INFO;
  }
};

export interface Config {
  /** RealtimeRegister API key for authentication */
  apiKey: string;
  /** Base URL for RealtimeRegister API */
  baseUrl: string;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Enable debug logging */
  debug: boolean;
  /** Logging level (error, warn, info, debug) */
  logLevel: string;
  /** MCP server name (read from package.json) */
  readonly serverName: string;
  /** MCP server version (read from package.json) */
  readonly serverVersion: string;
}

/**
 * Load configuration from environment variables
 */
/**
 * Configuration defaults
 */
const CONFIG_DEFAULTS = {
  baseUrl: 'https://api.yoursrs.com',
  requestTimeout: 30000,
  debug: false,
  logLevel: 'info',
} as const;

/**
 * Safely parses timeout value with fallback
 */
const parseTimeout = (value: string | undefined): number => {
  if (!value) return CONFIG_DEFAULTS.requestTimeout;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? CONFIG_DEFAULTS.requestTimeout : parsed;
};

/**
 * Load configuration from environment variables
 * Uses functional approach with clear error handling
 */
export const loadConfig = (): Config => {
  const apiKey = process.env.REALTIME_REGISTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'REALTIME_REGISTER_API_KEY environment variable is required. ' +
        'Please set your RealtimeRegister API key.'
    );
  }

  const packageInfo = getPackageInfo();

  return {
    apiKey,
    baseUrl: process.env.REALTIME_REGISTER_BASE_URL ?? CONFIG_DEFAULTS.baseUrl,
    requestTimeout: parseTimeout(process.env.REALTIME_REGISTER_TIMEOUT),
    debug: process.env.REALTIME_REGISTER_DEBUG === 'true',
    logLevel: process.env.LOG_LEVEL ?? CONFIG_DEFAULTS.logLevel,
    serverName: packageInfo.name,
    serverVersion: packageInfo.version,
  };
};

/**
 * Valid log levels
 */
const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/**
 * Validation rules for configuration
 */
const VALIDATION_RULES = {
  apiKey: (value: string) => value.length > 0 || 'API key is required',
  baseUrl: (value: string) => {
    if (!value) return 'Base URL is required';
    try {
      new URL(value);
      return true;
    } catch {
      return `Invalid base URL: ${value}`;
    }
  },
  requestTimeout: (value: number) => value > 0 || 'Request timeout must be positive',
  logLevel: (value: string) =>
    (VALID_LOG_LEVELS as readonly string[]).includes(value) ||
    `Invalid log level: ${value}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}`,
} as const;

/**
 * Validate configuration using functional approach
 * Throws descriptive errors for invalid configuration
 */
export const validateConfig = (config: Config): void => {
  const errors: string[] = [];

  // Validate each field
  Object.entries(VALIDATION_RULES).forEach(([field, validator]) => {
    const value = config[field as keyof Config];
    const result = (validator as (val: unknown) => string | boolean)(value);
    if (result !== true) {
      errors.push(result as string);
    }
  });

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
};
