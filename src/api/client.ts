import { Config } from '../core/config.js';
import RealtimeRegisterAPI, { type ApiConfiguration } from '@realtimeregister/api';
import axios, { type AxiosInstance, type AxiosError } from 'axios';

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
  private readonly sdk: RealtimeRegisterAPI;
  private readonly axiosInstance: AxiosInstance;

  constructor(config: Config) {

    // Configure the SDK
    const sdkConfig: ApiConfiguration = {
      apiKey: config.apiKey,
      customer: config.customer,
      baseURL: config.baseUrl,
      axiosConfig: {
        timeout: config.requestTimeout,
        headers: {
          'User-Agent': `${config.serverName}/${config.serverVersion}`,
        },
      },
    };

    this.sdk = new RealtimeRegisterAPI(sdkConfig);

    // Create a separate axios instance for generic requests
    this.axiosInstance = axios.create({
      baseURL: config.baseUrl,
      timeout: config.requestTimeout,
      headers: {
        Authorization: `ApiKey ${config.apiKey}`,
        'User-Agent': `${config.serverName}/${config.serverVersion}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Make an authenticated request to the RealtimeRegister API
   */
  public async request<T = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout } = options;

    try {
      const response = await this.axiosInstance.request<T>({
        url: endpoint,
        method,
        data: method !== 'GET' ? body : undefined,
        headers: headers,
        ...(timeout && { timeout }),
      });

      return response.data;
    } catch (error) {
      throw this.mapAxiosError(error, `Failed to make ${method} request to ${endpoint}`);
    }
  }

  /**
   * Check if error is an Axios error
   */
  private isAxiosError(error: unknown): error is AxiosError {
    return typeof error === 'object' && error !== null && 'isAxiosError' in error && !!(error as AxiosError).isAxiosError;
  }

  /**
   * Convert Axios error to RealtimeRegister error format
   */
  private toApiErrorIfHttp(error: unknown): RealtimeRegisterApiError | null {
    // Check for Axios errors first
    if (this.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText ?? '';
      const responseData = error.response.data;
      const message = this.formatErrorMessage(status, statusText, responseData);
      return new RealtimeRegisterApiError(message, status, statusText, responseData);
    }

    // Duck-typed check for response-like error objects
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object'
    ) {
      const response = error.response as Record<string, unknown>;
      const status = typeof response.status === 'number' ? response.status : 0;
      const statusText = typeof response.statusText === 'string' ? response.statusText : '';
      const responseData = response.data ?? response;
      const message = this.formatErrorMessage(status, statusText, responseData);
      return new RealtimeRegisterApiError(message, status, statusText, responseData);
    }

    return null;
  }

  /**
   * Map Axios/SDK errors to our custom error types
   */
  private mapAxiosError(error: unknown, prefix: string): Error {
    const apiError = this.toApiErrorIfHttp(error);
    if (apiError) return apiError;

    if (this.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return new RealtimeRegisterNetworkError(`${prefix}: Request timeout`, error);
      }
      if (error.code === 'ERR_CANCELED' || (error as any).name === 'CanceledError') {
        return new RealtimeRegisterNetworkError(`${prefix}: Request canceled`, error);
      }
      return new RealtimeRegisterNetworkError(
        `${prefix}: Network error${error.message ? ` - ${error.message}` : ''}`,
        error
      );
    }

    return new RealtimeRegisterNetworkError(
      `${prefix}: Unexpected error${error instanceof Error ? ` - ${error.message}` : ''}`,
      error instanceof Error ? error : undefined
    );
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
      // Use the official SDK's domain check method
      const response = await this.sdk.domains.check(lowercaseDomain);

      // Transform to our interface format
      const result: DomainAvailabilityResponse = {
        domain: lowercaseDomain,
        available: response.available,
      };

      // Add optional properties only if they exist
      // Note: RealtimeRegister API returns price in cents, convert to dollars
      if (response.price !== undefined) {
        result.price = Math.round(response.price) / 100;
      }
      if (response.currency !== undefined) {
        result.currency = response.currency;
      }
      if (response.reason !== undefined) {
        result.reason = response.reason;
      }

      return result;
    } catch (error) {
      // Map SDK errors to our custom error types
      throw this.mapAxiosError(error, 'Failed to check domain availability');
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
      await this.sdk.domains.check('test.com');
      return true;
    } catch (error) {
      // Only return false for authentication/authorization errors (401, 403)
      // Other errors (like rate limiting) should not indicate connection failure
      const apiError = this.toApiErrorIfHttp(error);
      if (apiError) {
        return apiError.status !== 401 && apiError.status !== 403;
      }
      return false;
    }
  }
}
