import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, validateConfig, type Config } from './config.js';
import { RealtimeRegisterApiError, RealtimeRegisterNetworkError } from '../api/client.js';
import { CachedRealtimeRegisterClient, type CachedApiClientOptions } from '../api/cached-client.js';
import { type BulkDomainCheckResult } from '../api/types/domain.js';
import { createLogger, type Logger, type LogLevel } from './logger.js';
import { ConfigurationError, ValidationError, MCPError } from './errors.js';

/**
 * RealtimeRegister MCP Server
 *
 * Provides Model Context Protocol server functionality for domain management
 * operations using the RealtimeRegister API.
 */
export class RealtimeRegisterMCPServer {
  private server: Server;
  private apiClient: CachedRealtimeRegisterClient | null = null;
  private config: Config | null = null;
  private logger: Logger;

  constructor() {
    // Initialize with a basic logger, will be updated when config is loaded
    this.logger = createLogger('info');

    this.server = new Server(
      {
        name: 'realtime-register-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  /**
   * Initialize the cached API client with configuration
   */
  private async initializeApiClient(): Promise<void> {
    try {
      this.config = loadConfig();
      validateConfig(this.config);

      // Update logger with configured log level
      this.logger = createLogger(this.config.logLevel as LogLevel);

      // Update server info with configured values
      this.server = new Server(
        {
          name: this.config.serverName,
          version: this.config.serverVersion,
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      // Initialize cached API client with caching enabled by default
      const cachedClientOptions: CachedApiClientOptions = {
        enableCaching: true,
        enableDebugLogging: this.config.debug || false,
        fallbackOnCacheError: true,
      };

      this.apiClient = new CachedRealtimeRegisterClient(this.config, cachedClientOptions);
      this.logger.info('Cached API client initialized successfully');
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to initialize API client', error.message);
        throw new ConfigurationError(error.message, error);
      }
      this.logger.error('Failed to initialize API client', String(error));
      throw new ConfigurationError('Unknown configuration error');
    }
  }

  /**
   * Set up MCP tool handlers
   */
  private setupToolHandlers(): void {
    // Handle listing available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'check_domain_availability',
            description:
              'Check if a domain name is available for registration using RealtimeRegister API',
            inputSchema: {
              type: 'object',
              properties: {
                domain: {
                  type: 'string',
                  description: 'The domain name to check (e.g., example.com)',
                },
              },
              required: ['domain'],
            },
          },
          {
            name: 'check_bulk_domains',
            description:
              'Check availability of multiple domains simultaneously with caching and rate limiting',
            inputSchema: {
              type: 'object',
              properties: {
                domains: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of domain names to check (max 50 per request)',
                  minItems: 1,
                  maxItems: 50,
                },
              },
              required: ['domains'],
            },
          },
          {
            name: 'test_api_connection',
            description: 'Test connectivity and authentication with RealtimeRegister API',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'check_domain_availability':
            return await this.handleCheckDomainAvailability(args as { domain: string });

          case 'check_bulk_domains':
            return await this.handleCheckBulkDomains(args as { domains: string[] });

          case 'test_api_connection':
            return await this.handleTestApiConnection({} as Record<string, never>);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Handle domain availability checking tool
   */
  private async handleCheckDomainAvailability(args: { domain: string }) {
    const { domain } = args;

    if (!domain || typeof domain !== 'string') {
      throw new ValidationError('Domain parameter is required and must be a string', 'domain');
    }

    this.logger.debug('Checking domain availability', { domain });

    // Ensure API client is initialized
    if (!this.apiClient) {
      await this.initializeApiClient();
      if (!this.apiClient) {
        throw new ConfigurationError(
          'API client not initialized. Please check your configuration:\n' +
            '- REALTIME_REGISTER_API_KEY environment variable must be set\n' +
            '- REALTIME_REGISTER_BASE_URL is optional (defaults to https://api.realtimeregister.com)'
        );
      }
    }

    try {
      const result = await this.apiClient.checkDomainAvailability(domain);

      this.logger.info('Domain availability check completed', {
        domain: result.domain,
        available: result.available,
      });

      const statusText = result.available ? '✅ Available' : '❌ Not Available';
      let message = `Domain: **${result.domain}**\nStatus: ${statusText}`;

      if (result.price && result.currency) {
        // Format price as currency (price is already converted from cents to dollars)
        const formattedPrice = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: result.currency,
          minimumFractionDigits: 2,
        }).format(result.price);
        const premiumText = result.price > 10 ? ' (Premium)' : '';
        message += `\nPrice: ${formattedPrice}${premiumText}`;
      }

      if (result.reason) {
        message += `\nReason: ${result.reason}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Domain availability check failed', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof RealtimeRegisterApiError) {
        throw new MCPError(
          `API Error (${error.status}): ${error.message}`,
          'check_domain_availability'
        );
      }

      if (error instanceof RealtimeRegisterNetworkError) {
        throw new MCPError(`Network Error: ${error.message}`, 'check_domain_availability');
      }

      throw error;
    }
  }

  /**
   * Handle bulk domain availability checking tool
   */
  private async handleCheckBulkDomains(args: { domains: string[] }) {
    const { domains } = args as { domains: string[] };

    // Input validation
    if (!Array.isArray(domains)) {
      throw new ValidationError('Domains parameter is required and must be an array', 'domains');
    }

    if (domains.length === 0) {
      throw new ValidationError('Domains array cannot be empty', 'domains');
    }

    if (domains.length > 50) {
      throw new ValidationError(
        'Domains array cannot contain more than 50 domains per request',
        'domains'
      );
    }

    // Validate each domain is a string
    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      if (typeof domain !== 'string' || !domain.trim()) {
        throw new ValidationError(`Domain at index ${i} must be a non-empty string`, 'domains');
      }
    }

    // Normalize domains (remove whitespace, convert to lowercase)
    const normalizedDomains = domains.map((domain) => domain.trim().toLowerCase());

    this.logger.debug('Checking bulk domain availability', {
      domainCount: normalizedDomains.length,
      domains: normalizedDomains,
    });

    // Ensure API client is initialized
    if (!this.apiClient) {
      await this.initializeApiClient();
      if (!this.apiClient) {
        throw new ConfigurationError(
          'API client not initialized. Please check your configuration:\n' +
            '- REALTIME_REGISTER_API_KEY environment variable must be set\n' +
            '- REALTIME_REGISTER_BASE_URL is optional (defaults to https://api.realtimeregister.com)'
        );
      }
    }

    try {
      const result = await this.apiClient.checkDomainsAvailability(normalizedDomains);

      this.logger.info('Bulk domain availability check completed', {
        totalDomains: result.summary.totalDomains,
        successful: result.summary.successfulChecks,
        failed: result.summary.failedChecks,
        cacheHits: result.summary.cacheHits,
        processingTime: result.metadata.processingTimeMs,
      });

      return {
        content: [
          {
            type: 'text',
            text: this.formatBulkDomainResponse(result),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Bulk domain availability check failed', {
        domainCount: normalizedDomains.length,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof RealtimeRegisterApiError) {
        throw new MCPError(`API Error (${error.status}): ${error.message}`, 'check_bulk_domains');
      }

      if (error instanceof RealtimeRegisterNetworkError) {
        throw new MCPError(`Network Error: ${error.message}`, 'check_bulk_domains');
      }

      throw error;
    }
  }

  /**
   * Format bulk domain check results for user-friendly display
   */
  private formatBulkDomainResponse(result: BulkDomainCheckResult): string {
    const { successful, failed, summary, metadata } = result;

    let response = `# 🔍 Bulk Domain Availability Check Results\n\n`;

    // Summary section
    response += `## 📊 Summary\n`;
    response += `- **Total Domains Checked**: ${summary.totalDomains}\n`;
    response += `- **Available**: ${successful.filter((d) => d.available).length}\n`;
    response += `- **Unavailable**: ${successful.filter((d) => !d.available).length}\n`;
    response += `- **Failed Checks**: ${summary.failedChecks}\n`;
    response += `- **Success Rate**: ${summary.successRate.toFixed(1)}%\n`;
    response += `- **Cache Hits**: ${summary.cacheHits} / ${
      summary.apiCalls + summary.cacheHits
    } (${
      summary.cacheHits > 0
        ? ((summary.cacheHits / (summary.apiCalls + summary.cacheHits)) * 100).toFixed(1)
        : '0'
    }%)\n`;
    response += `- **Processing Time**: ${metadata.processingTimeMs}ms\n\n`;

    // Available domains section
    const availableDomains = successful.filter((d) => d.available);
    if (availableDomains.length > 0) {
      response += `## ✅ Available Domains (${availableDomains.length})\n`;
      for (const domain of availableDomains) {
        response += `- **${domain.domain}**`;
        if (domain.price && domain.currency) {
          // Format price as currency (price is already converted from cents to dollars)
          const formattedPrice = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: domain.currency,
            minimumFractionDigits: 2,
          }).format(domain.price);
          const premiumText = domain.price > 10 ? ' (Premium)' : '';
          response += ` - ${formattedPrice}${premiumText}`;
        }
        response += `\n`;
      }
      response += `\n`;
    }

    // Unavailable domains section
    const unavailableDomains = successful.filter((d) => !d.available);
    if (unavailableDomains.length > 0) {
      response += `## ❌ Unavailable Domains (${unavailableDomains.length})\n`;
      for (const domain of unavailableDomains) {
        response += `- **${domain.domain}**`;
        if (domain.reason) {
          response += ` - ${domain.reason}`;
        }
        response += `\n`;
      }
      response += `\n`;
    }

    // Failed checks section
    if (failed.length > 0) {
      response += `## ⚠️ Failed Checks (${failed.length})\n`;
      for (const failure of failed) {
        response += `- **${failure.domain}**: ${failure.error}`;
        if (failure.errorCode) {
          response += ` (${failure.errorCode})`;
        }
        response += `\n`;
      }
      response += `\n`;
    }

    // Performance details
    response += `## 🔧 Performance Details\n`;
    response += `- **Chunks Processed**: ${metadata.chunkCount}\n`;
    response += `- **Chunk Size**: ${metadata.chunkSize}\n`;
    response += `- **API Calls Made**: ${summary.apiCalls}\n`;
    response += `- **Start Time**: ${metadata.startTime.toISOString()}\n`;
    response += `- **End Time**: ${metadata.endTime.toISOString()}\n`;

    return response;
  }

  /**
   * Handle API connection testing tool
   */
  private async handleTestApiConnection(
    _args: Record<string, never>
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    // Ensure API client is initialized
    if (!this.apiClient) {
      await this.initializeApiClient();
      if (!this.apiClient) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ **API Connection Test Failed**\n\nAPI client not initialized. Please check your configuration:\n- REALTIME_REGISTER_API_KEY environment variable must be set\n- REALTIME_REGISTER_BASE_URL is optional (defaults to https://api.realtimeregister.com)',
            },
          ],
        };
      }
    }

    try {
      const isConnected = await this.apiClient.testConnection();

      if (isConnected) {
        return {
          content: [
            {
              type: 'text',
              text: '✅ **API Connection Test Successful**\n\nSuccessfully connected to RealtimeRegister API with valid authentication.',
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: '❌ **API Connection Test Failed**\n\nUnable to connect to RealtimeRegister API. Please check:\n- Your API key is valid\n- Network connectivity\n- API endpoint availability',
            },
          ],
        };
      }
    } catch (error) {
      let errorDetails = '';

      if (error instanceof RealtimeRegisterApiError) {
        errorDetails = `API Error (${error.status}): ${error.message}`;
      } else if (error instanceof RealtimeRegisterNetworkError) {
        errorDetails = `Network Error: ${error.message}`;
      } else {
        errorDetails = error instanceof Error ? error.message : String(error);
      }

      return {
        content: [
          {
            type: 'text',
            text: `❌ **API Connection Test Failed**\n\n${errorDetails}`,
          },
        ],
      };
    }
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      this.logger.info('MCP server started successfully', {
        serverName: 'realtime-register-mcp',
        serverVersion: '0.1.0',
      });
    } catch (error) {
      this.logger.error(
        'Failed to start MCP server',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      await this.server.close();
      this.logger.info('MCP server stopped successfully');
    } catch (error) {
      this.logger.error(
        'Error stopping MCP server',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
