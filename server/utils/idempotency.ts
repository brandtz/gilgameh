import type { H3Event } from 'h3'
import { getHeader, setResponseHeader, setResponseStatus } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { sha256Hex } from './crypto'
import { Errors } from './errors'
import type { ActorContext } from './auth-context'

export async function withIdempotency<T>(
  event: H3Event,
  ctx: ActorContext,
  body: unknown,
  handler: () => Promise<{ statusCode?: number; body: T }>
): Promise<T> {
  const key = getHeader(event, 'idempotency-key')?.trim()
  if (!key) {
    const result = await handler()
    if (result.statusCode) {
      setResponseStatus(event, result.statusCode)
    }
    return result.body
  }

  const method = event.method.toUpperCase()
  const path = event.path.split('?')[0]
  const requestHash = sha256Hex(JSON.stringify(body ?? null))
  const db = await getDb()

  const [existing] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.tenantId, ctx.tenantId),
        eq(schema.idempotencyKeys.key, key),
        eq(schema.idempotencyKeys.method, method),
        eq(schema.idempotencyKeys.path, path)
      )
    )

  if (existing && existing.expiresAt.getTime() > Date.now()) {
    if (existing.requestHash !== requestHash) {
      throw Errors.idempotencyConflict(key)
    }
    setResponseStatus(event, existing.responseStatus)
    setResponseHeader(event, 'X-Idempotent-Replayed', 'true')
    return existing.responseBody as T
  }

  const result = await handler()
  const statusCode = result.statusCode ?? 200
  setResponseStatus(event, statusCode)

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await db
    .insert(schema.idempotencyKeys)
    .values({
      tenantId: ctx.tenantId,
      key,
      method,
      path,
      requestHash,
      responseStatus: statusCode,
      responseBody: result.body as unknown,
      expiresAt
    })
    .onConflictDoNothing()

  return result.body
}
