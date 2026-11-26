import { defineEventHandler, getHeader, getRequestIP, setResponseHeader, setResponseStatus } from 'h3'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export default defineEventHandler((event) => {
  const requestId = getHeader(event, 'x-request-id') || randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'X-Request-Id', requestId)

  const path = event.path || ''
  if (!path.startsWith('/api/')) return

  // Skip rate limit in Vitest unless explicitly testing rate limits
  if (process.env.VITEST === 'true' && process.env.TEST_RATE_LIMIT !== 'true') return

  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000)
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120)
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'local'
  const authHint = getHeader(event, 'authorization')?.slice(0, 24) || 'anon'
  const key = `${ip}:${authHint}`

  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1

  const remaining = Math.max(0, maxRequests - bucket.count)
  setResponseHeader(event, 'X-RateLimit-Limit', String(maxRequests))
  setResponseHeader(event, 'X-RateLimit-Remaining', String(remaining))
  setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

  if (bucket.count > maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    setResponseHeader(event, 'Retry-After', retryAfterSec)
    setResponseStatus(event, 429)
    logger.warn('Rate limit exceeded', { requestId, path, method: event.method })
    return {
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded',
        details: { retryAfterSec },
        requestId
      }
    }
  }
})
