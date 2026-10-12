import pino from 'pino';
import type { LogLevel } from './env.ts';

export type Logger = pino.Logger;

/** Secrets that must never reach a log line, wherever they appear in a logged object. */
const REDACTED_PATHS = [
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'headers.authorization',
  '*.headers.authorization',
  'headers.cookie',
  '*.headers.cookie',
];

export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    redact: REDACTED_PATHS,
    transport: process.stdout.isTTY ? { target: 'pino-pretty' } : undefined,
  });
}
