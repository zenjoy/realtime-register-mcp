import { Config } from '../core/config.js';
import fetch, { RequestInit as NodeFetchRequestInit } from 'node-fetch';

/**
 * HTTP methods supported by the API client
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * API request options
 */
export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * API Error class for handling RealtimeRegister API errors
 */
export class RealtimeRegisterApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'RealtimeRegisterApiError';
  }
}

/**
 * Network Error class for handling network-related errors
 */
export class RealtimeRegisterNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RealtimeRegisterNetworkError';
  }
}

/**
 * Domain availability response from RealtimeRegister API
 */
export interface DomainAvailabilityResponse {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
  reason?: string;
}

/**
 * RealtimeRegister API Client
 *
 * Provides authenticated HTTP client for interacting with RealtimeRegister API
 */
export class RealtimeRegisterClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Make an authenticated request to the RealtimeRegister API
   */
  public async request<T = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout = this.config.requestTimeout } = options;

    const url = `${this.config.baseUrl}${endpoint}`;

    // Debug logging removed - interferes with MCP JSON-RPC protocol

    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const requestHeaders: HeadersInit = {
        Authorization: `ApiKey ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'realtime-register-mcp/0.1.0',
        ...headers,
      };

      const requestOptions: NodeFetchRequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      // Add body for non-GET requests
      if (body && method !== 'GET') {
        requestOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, requestOptions);

      // Clear timeout if request completed
      clearTimeout(timeoutId);

      // Handle HTTP error responses
      if (!response.ok) {
        let errorResponse: unknown;
        try {
          errorResponse = await response.json();
        } catch {
          // Ignore JSON parsing errors for error responses
        }

        const errorMessage = this.formatErrorMessage(
          response.status,
          response.statusText,
          errorResponse
        );
        throw new RealtimeRegisterApiError(
          errorMessage,
          response.status,
          response.statusText,
          errorResponse
        );
      }

      // Parse successful response
      const responseData = await response.json();

      // Debug logging removed - interferes with MCP JSON-RPC protocol

      return responseData as T;
    } catch (error) {
      clearTimeout(timeoutId);

      // Re-throw API errors as-is
      if (error instanceof RealtimeRegisterApiError) {
        throw error;
      }

      // Handle abort/timeout errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RealtimeRegisterNetworkError(`Request timeout after ${timeout}ms`, error);
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new RealtimeRegisterNetworkError(`Network error: ${error.message}`, error);
      }

      // Handle other errors
      throw new RealtimeRegisterNetworkError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Format error message from API response
   */
  private formatErrorMessage(status: number, statusText: string, response?: unknown): string {
    let message = `API Error: ${status} ${statusText}`;

    if (response && typeof response === 'object' && response !== null) {
      // Try to extract error message from common response formats
      const errorResponse = response as Record<string, unknown>;

      if (typeof errorResponse.message === 'string') {
        message += ` - ${errorResponse.message}`;
      } else if (typeof errorResponse.error === 'string') {
        message += ` - ${errorResponse.error}`;
      } else if (Array.isArray(errorResponse.errors) && errorResponse.errors.length > 0) {
        const errors = errorResponse.errors
          .map((err: unknown) => (typeof err === 'string' ? err : JSON.stringify(err)))
          .join(', ');
        message += ` - ${errors}`;
      }
    }

    return message;
  }

  /**
   * Check domain availability
   *
   * @param domain - The domain name to check (e.g., "example.com")
   * @returns Promise resolving to domain availability information
   */
  async checkDomainAvailability(domain: string): Promise<DomainAvailabilityResponse> {
    // Minimal client-side validation - just check for basic input sanity
    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      throw new Error('Domain must be a non-empty string');
    }

    // Convert to lowercase (RealtimeRegister expects lowercase)
    const lowercaseDomain = domain.trim().toLowerCase();

    try {
      // Let the RealtimeRegister API handle all validation - it knows best!
      // Use official RealtimeRegister domain check endpoint: GET /v2/domains/{domainName}/check
      const response = await this.request<{
        available: boolean;
        reason?: string;
        premium?: boolean;
        currency?: string;
        price?: number;
      }>(`/v2/domains/${encodeURIComponent(lowercaseDomain)}/check`);

      // Transform to our interface format
      const result: DomainAvailabilityResponse = {
        domain: lowercaseDomain,
        available: response.available,
      };

      // Add optional properties only if they exist
      // Note: RealtimeRegister API returns price in cents, convert to dollars
      if (response.price !== undefined) {
        result.price = response.price / 100;
      }
      if (response.currency !== undefined) {
        result.currency = response.currency;
      }
      if (response.reason !== undefined) {
        result.reason = response.reason;
      }

      return result;
    } catch (error) {
      // Pass through API errors - they contain the authoritative validation messages
      if (
        error instanceof RealtimeRegisterApiError ||
        error instanceof RealtimeRegisterNetworkError
      ) {
        throw error;
      }

      throw new Error(
        `Failed to check domain availability: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Test API connectivity and authentication
   *
   * @returns Promise resolving to true if API is accessible and authenticated
   */
  async testConnection(): Promise<boolean> {
    try {
      // Use a simple domain check to test connectivity and authentication
      // This is lightweight and doesn't require specific customer context
      await this.request('/v2/domains/test.com/check');
      return true;
    } catch (error) {
      // Debug logging removed - interferes with MCP JSON-RPC protocol
      // Only return false for authentication/authorization errors (401, 403)
      // Other errors (like rate limiting) should not indicate connection failure
      if (error instanceof RealtimeRegisterApiError) {
        return error.status !== 401 && error.status !== 403;
      }
      return false;
    }
  }
}
