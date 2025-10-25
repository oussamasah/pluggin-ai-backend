// src/core/logger.ts
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      '*.password',
      '*.secret',
      '*.token',
      '*.key',
      '*.apiKey',
      '*.api_key'
    ],
    censor: '**REDACTED**'
  }
});

// Custom log methods for different contexts
export const apiLogger = logger.child({ context: 'api' });
export const workflowLogger = logger.child({ context: 'workflow' });
export const websocketLogger = logger.child({ context: 'websocket' });
export const databaseLogger = logger.child({ context: 'database' });