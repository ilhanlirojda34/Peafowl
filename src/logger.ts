import pino from 'pino';
import type { Config } from './config.ts';

export type Logger = pino.Logger;

export function createLogger(config: Pick<Config, 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: ['apiKey', '*.apiKey', 'headers.authorization', '*.headers.authorization'],
    transport: process.stdout.isTTY ? { target: 'pino-pretty' } : undefined,
  });
}
