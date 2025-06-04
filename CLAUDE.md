# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that integrates AI assistants with the RealtimeRegister API for domain management operations. The server provides domain availability checking, bulk domain processing, and API connectivity testing through MCP tools.

## Core Commands

### Development Commands
- `yarn build` - Compile TypeScript to JavaScript in dist/
- `yarn dev` - Run server in development mode with tsx hot reloading
- `yarn type-check` - Run TypeScript type checking without compilation
- `yarn test` - Run Jest test suite
- `yarn test:watch` - Run tests in watch mode
- `yarn test:coverage` - Generate test coverage report
- `yarn clean` - Remove compiled dist/ directory

### Production Commands
- `yarn start` - Run compiled server from dist/

## Architecture Overview

### Project Structure (Feature-Based)

```
src/
├── core/           # Core server and configuration
├── api/            # RealtimeRegister API clients
├── cache/          # Caching infrastructure
└── monitoring/     # Performance and reliability
```

### Core Module (`src/core/`)

**Server Architecture (`core/server.ts`)**
- `RealtimeRegisterMCPServer` - Main MCP server class using stdio transport
- Provides 3 MCP tools: `check_domain_availability`, `check_bulk_domains`, `test_api_connection`
- Lazy initialization pattern for API client (starts without configuration)

**Configuration (`core/config.ts`)**
- Functional configuration loading with validation
- Environment variables with sensible defaults
- Type-safe configuration management

**Error Handling (`core/errors.ts`)**
- Custom error hierarchy with proper inheritance
- Specific error types: ConfigurationError, ValidationError, ApiError, NetworkError, MCPError
- Proper error chaining and context preservation

**Utilities (`core/utils.ts`)**
- Functional programming utilities (pipe, compose, retry, timeout)
- Type-safe Result type for error handling
- Common type guards and validation functions

### API Module (`src/api/`)

**Base Client (`api/client.ts`)**
- `RealtimeRegisterClient` - HTTP client for RealtimeRegister API
- Bearer token authentication and request/response handling
- Basic domain availability checking and connection testing

**Cached Client (`api/cached-client.ts`)**
- `CachedRealtimeRegisterClient` - Adds LRU caching and bulk processing
- Multi-domain concurrent processing with rate limiting
- Performance optimization with cache hit tracking

**Types (`api/types/domain.ts`)**
- Domain-specific type definitions
- Bulk operation result types and metadata

### Cache Module (`src/cache/`)

**LRU Cache (`cache/lru-cache.ts`)**
- Generic LRU cache with TTL support
- Memory tracking and automatic cleanup
- Performance metrics and debug logging

**Cache Factory (`cache/factory.ts`)**
- Preconfigured cache instances for different use cases
- Domain-specific cache configurations
- Cache management and statistics

### Monitoring Module (`src/monitoring/`)

**Circuit Breaker (`monitoring/circuit-breaker.ts`)**
- Fault tolerance for API calls with state management
- Exponential backoff and failure rate monitoring
- Configurable thresholds and recovery mechanisms

**Rate Limiter (`monitoring/rate-limiter.ts`)**
- Sliding window rate limiting implementation
- Burst protection and request queuing
- Configurable limits per operation type

**API Monitor (`monitoring/api-monitor.ts`)**
- Performance metrics collection and alerting
- Health check monitoring and status reporting
- Event-driven architecture for real-time monitoring

### Configuration

Environment variables loaded via `core/config.ts`:
- `REALTIME_REGISTER_API_KEY` (required) - API authentication
- `REALTIME_REGISTER_BASE_URL` (optional) - Defaults to https://api.yoursrs.com
- `REALTIME_REGISTER_TIMEOUT` (optional) - Request timeout in milliseconds
- `REALTIME_REGISTER_DEBUG` (optional) - Enable debug logging

### Key Design Patterns

**Lazy Initialization**: Server starts without API configuration, initializes on first tool call
**Functional Programming**: Extensive use of pure functions, composition, and immutable data
**Result Types**: Type-safe error handling using Result<T, E> pattern
**Module Federation**: Feature-based organization with clear module boundaries
**Performance First**: Multi-layer caching, circuit breakers, and rate limiting

### Test Coverage

Current coverage: **79.98%** (improved from 76.88%)
- All core utilities: 98.64% coverage
- Error classes: 100% coverage  
- Configuration: 88.63% coverage
- Monitoring components: 90%+ coverage

### Entry Points

- `src/index.ts` - CLI entry point with graceful shutdown
- `src/core/server.ts` - MCP server implementation
- Module exports via barrel patterns (index.ts files)
- Main execution flow: index.ts → core/server.ts → api/cached-client.ts → api/client.ts