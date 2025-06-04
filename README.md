# RealtimeRegister MCP Server & Client

[![npm version](https://badge.fury.io/js/realtime-register-mcp.svg)](https://badge.fury.io/js/realtime-register-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A Node.js library and Model Context Protocol (MCP) server for interacting with the RealtimeRegister API for domain management operations.

## Overview

This package provides a robust client for the RealtimeRegister API and an MCP-compliant server, enabling applications and AI assistants to:

- Check domain name availability.
- Test API connectivity.
- Perform other domain-related operations (future).

It features a caching layer for performance, typed responses, and comprehensive error handling.

## Features

- **RealtimeRegister API Client**: Strongly-typed client for core API functions.
- **Caching Layer**: Built-in LRU caching for `checkDomainAvailability` and other requests to reduce API calls and improve response times.
- **MCP Server**: Exposes functionality via the Model Context Protocol for integration with MCP-compatible systems.
- **Environment Configuration**: Easy setup using environment variables.
- **Error Handling**: Custom error types for API and network issues.
- **TypeScript Support**: Written in TypeScript with declaration files for a better development experience.

## Prerequisites

- Node.js 18.0.0 or higher / or Docker
- RealtimeRegister API key (for most functionality)

## Installation

### Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

#### npx

```json
{
  "mcpServers": {
    "realtime-register": {
      "command": "npx",
      "args": ["-y", "realtime-register-mcp"],
      "env": {
        "REALTIME_REGISTER_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

The `realtime-register-mcp` provides the following tools:

- `check_domain_availability` (params: `domain: string`)
- `check_bulk_domains` (params: `domains: string[]`)
- `test_api_connection` (params: `random_string: string` (dummy parameter))

## Environment Variables

The server and client are configured using environment variables:

- **`REALTIME_REGISTER_API_KEY`** (Required): Your RealtimeRegister API key.
- `REALTIME_REGISTER_BASE_URL` (Optional): API base URL (default: `https://api.yoursrs.com`).
- `REALTIME_REGISTER_TIMEOUT` (Optional): Request timeout in milliseconds (default: `30000`).
- `REALTIME_REGISTER_DEBUG` (Optional): Set to `true` to enable detailed debug logging (default: `false`).
- `LOG_LEVEL` (Optional): Set the logging level (e.g., `error`, `warn`, `info`, `debug`). Default is `info`.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request on GitHub.

- [Issue Tracker](https://github.com/zenjoy/realtime-register-mcp/issues)
- [Source Code](https://github.com/zenjoy/realtime-register-mcp)

Please ensure your contributions adhere to the existing code style and that all tests pass.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
