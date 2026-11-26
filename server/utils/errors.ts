import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { ZodError } from 'zod'
import { logger } from './logger'

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'APPROVAL_REQUIRED_IN_UI'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DUPLICATE_DETECTED'
  | 'UNPROCESSABLE_ENTITY'
  | 'MATH_MISMATCH'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly statusCode: number
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const Errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'BAD_REQUEST', message, details),
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Insufficient permissions', details?: Record<string, unknown>) =>
    new AppError(403, 'FORBIDDEN', message, details),
  approvalRequiredInUi: (message: string, approvalUrl: string) =>
    new AppError(403, 'APPROVAL_REQUIRED_IN_UI', message, { approvalUrl }),
  notFound: (entity: string, id?: string) =>
    new AppError(404, 'NOT_FOUND', id ? `${entity} (${id}) not found` : `${entity} not found`),
  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppError(409, 'CONFLICT', message, details),
  versionConflict: (expected: number, actual: number) =>
    new AppError(
      409,
      'VERSION_CONFLICT',
      `Optimistic concurrency conflict: expected version ${expected}, current version is ${actual}`,
      { expectedVersion: expected, currentVersion: actual }
    ),
  idempotencyConflict: (key: string) =>
    new AppError(
      409,
      'IDEMPOTENCY_CONFLICT',
      `Idempotency-Key "${key}" was already used with a different request payload`,
      { idempotencyKey: key }
    ),
  unprocessable: (message: string, details?: Record<string, unknown>) =>
    new AppError(422, 'UNPROCESSABLE_ENTITY', message, details),
  mathMismatch: (field: string, expected: number, provided: number) =>
    new AppError(
      422,
      'MATH_MISMATCH',
      `Server-computed ${field} (${expected} cents) does not match client-supplied value (${provided} cents)`,
      { field, expectedCents: expected, providedCents: provided }
    ),
  tooManyRequests: (retryAfterSec: number) =>
    new AppError(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded', { retryAfterSec })
}

export function handleApiError(event: H3Event, err: unknown) {
  const requestId = (event.context.requestId as string | undefined) || undefined

  if (err instanceof AppError) {
    setResponseStatus(event, err.statusCode)
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        ...(requestId ? { requestId } : {})
      }
    }
  }

  if (err instanceof ZodError) {
    setResponseStatus(event, 400)
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message
          }))
        },
        ...(requestId ? { requestId } : {})
      }
    }
  }

  logger.error('Unhandled API error', {
    requestId,
    errorName: err instanceof Error ? err.name : 'UnknownError',
    errorMessage: err instanceof Error ? err.message : String(err)
  })

  setResponseStatus(event, 500)
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred',
      ...(requestId ? { requestId } : {})
    }
  }
}

export function defineApiHandler<T>(
  fn: (event: H3Event) => Promise<T>
) {
  return async (event: H3Event) => {
    try {
      return await fn(event)
    } catch (err) {
      return handleApiError(event, err)
    }
  }
}
