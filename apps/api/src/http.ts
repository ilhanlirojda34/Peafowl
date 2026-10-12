import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export type ErrorCode =
  | 'invalid-request'
  | 'unauthenticated'
  | 'not-found'
  | 'conflict'
  | 'quota-exceeded'
  | 'invalid-answers'
  | 'internal';

/** An error the client is meant to see. Anything else becomes a generic 500. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (resource: string) =>
  new HttpError(404, 'not-found', `${resource} not found`);

/** Validates untrusted input. Reports which fields are wrong, never echoes their values. */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw new HttpError(400, 'invalid-request', 'The request is not valid', fields);
}

export function handleError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  // Fastify's own client errors (malformed JSON, body too large) keep their status and message.
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return reply.status(statusCode).send({ error: 'invalid-request', message: error.message });
  }
  request.log.error({ err: error }, 'Unhandled request error');
  return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
}
