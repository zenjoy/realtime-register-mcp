/**
 * Error classes for RealtimeRegister MCP Server
 */

/**
 * Base error class for all RealtimeRegister MCP errors
 */
export abstract class RealtimeRegisterMCPError extends Error {
  abstract readonly code: string;

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends RealtimeRegisterMCPError {
  readonly code = 'CONFIGURATION_ERROR';

  constructor(message: string, cause?: Error) {
    super(`Configuration error: ${message}`, cause);
  }
}

/**
 * Validation errors for input parameters
 */
export class ValidationError extends RealtimeRegisterMCPError {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string, public readonly field?: string, cause?: Error) {
    super(`Validation error: ${message}`, cause);
  }
}

/**
 * API-related errors from RealtimeRegister service
 */
export class ApiError extends RealtimeRegisterMCPError {
  readonly code = 'API_ERROR';

  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: unknown,
    cause?: Error
  ) {
    super(`API error (${status} ${statusText}): ${message}`, cause);
  }
}

/**
 * Network and connectivity errors
 */
export class NetworkError extends RealtimeRegisterMCPError {
  readonly code = 'NETWORK_ERROR';

  constructor(message: string, cause?: Error) {
    super(`Network error: ${message}`, cause);
  }
}

/**
 * MCP protocol-related errors
 */
export class MCPError extends RealtimeRegisterMCPError {
  readonly code = 'MCP_ERROR';

  constructor(message: string, public readonly toolName?: string, cause?: Error) {
    super(`MCP error: ${message}`, cause);
  }
}
