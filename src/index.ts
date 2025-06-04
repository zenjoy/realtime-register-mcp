#!/usr/bin/env node

import { RealtimeRegisterMCPServer } from './core/server.js';

/**
 * Main entry point for the RealtimeRegister MCP Server
 */
async function main(): Promise<void> {
  const server = new RealtimeRegisterMCPServer();

  try {
    // The server's start method should handle its own config loading, logger setup, and listening.
    await server.start();
    // MCP servers typically should not log to stdout/stderr after successful start,
    // as it can interfere with the JSON-RPC communication over stdio.
    // Logging should be directed to a file or other transport, handled by the logger within the server.
  } catch (error) {
    // If server.start() throws, it might be before its internal logger is fully set up,
    // or the error is critical. Log to console as a last resort.
    console.error('Failed to start RealtimeRegister MCP Server:', error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  // Catch any unhandled errors from main() itself (e.g., if new RealtimeRegisterMCPServer() fails)
  console.error('Unhandled critical error during server startup:', error);
  process.exit(1);
});
