/**
 * Logging infrastructure for RealtimeRegister MCP Server
 */

import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * File-based logger that doesn't interfere with MCP stdio communication
 */
export class FileLogger implements Logger {
  private readonly levels: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  private readonly logFile: string;
  private readonly enableFileLogging: boolean;

  constructor(
    private readonly logLevel: LogLevel = 'info',
    enableFileLogging: boolean = false
  ) {
    this.enableFileLogging = enableFileLogging;
    this.logFile = join(process.cwd(), 'mcp-server.log');

    // Initialize log file only if file logging is enabled
    if (this.enableFileLogging) {
      try {
        writeFileSync(this.logFile, `=== MCP Server Started at ${new Date().toISOString()} ===\n`);
      } catch {
        // Ignore file write errors in production
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [RealtimeRegister]`;
    const argsStr =
      args.length > 0
        ? ` ${args
            .map((arg) => {
              if (typeof arg === 'object' && arg !== null) {
                return JSON.stringify(arg);
              }
              if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
                return String(arg);
              }
              return String(arg);
            })
            .join(' ')}`
        : '';
    return `${prefix} ${message}${argsStr}\n`;
  }

  private writeLog(level: LogLevel, message: string, ...args: unknown[]): void {
    if (this.shouldLog(level) && this.enableFileLogging) {
      try {
        appendFileSync(this.logFile, this.formatMessage(level, message, ...args));
      } catch {
        // Ignore file write errors in production
      }
    }
  }

  error(message: string, ...args: unknown[]): void {
    this.writeLog('error', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.writeLog('warn', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.writeLog('info', message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.writeLog('debug', message, ...args);
  }
}

/**
 * Create a logger instance with the specified log level and optional file logging
 */
export function createLogger(logLevel: LogLevel, enableFileLogging: boolean = false): Logger {
  return new FileLogger(logLevel, enableFileLogging);
}
