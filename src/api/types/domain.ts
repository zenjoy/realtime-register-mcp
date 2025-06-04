import { DomainAvailabilityResponse } from '../client.js';

/**
 * Result of a bulk domain availability check operation
 */
export interface BulkDomainCheckResult {
  /** Successfully checked domains with their availability status */
  successful: DomainAvailabilityResponse[];
  /** Failed domain checks with error information */
  failed: FailedDomainCheck[];
  /** Summary statistics for the bulk operation */
  summary: BulkCheckSummary;
  /** Processing metadata for debugging and monitoring */
  metadata: BulkCheckMetadata;
}

/**
 * Information about a failed domain check
 */
export interface FailedDomainCheck {
  /** The domain name that failed to check */
  domain: string;
  /** Error message describing the failure */
  error: string;
  /** Error code if available */
  errorCode?: string;
  /** Whether this was a network error, API error, or validation error */
  errorType: 'network' | 'api' | 'validation' | 'unknown';
}

/**
 * Summary statistics for a bulk domain check operation
 */
export interface BulkCheckSummary {
  /** Total number of domains processed */
  totalDomains: number;
  /** Number of successful domain checks */
  successfulChecks: number;
  /** Number of failed domain checks */
  failedChecks: number;
  /** Number of domains retrieved from cache */
  cacheHits: number;
  /** Number of domains that required API calls */
  apiCalls: number;
  /** Success rate as a percentage (0-100) */
  successRate: number;
}

/**
 * Processing metadata for bulk operations
 */
export interface BulkCheckMetadata {
  /** When the bulk operation started */
  startTime: Date;
  /** When the bulk operation completed */
  endTime: Date;
  /** Total processing time in milliseconds */
  processingTimeMs: number;
  /** Number of chunks the domains were split into */
  chunkCount: number;
  /** Size of each chunk */
  chunkSize: number;
}
