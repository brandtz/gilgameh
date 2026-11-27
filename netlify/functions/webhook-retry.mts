import { createHmac } from 'node:crypto'

// Must match WEBHOOK_RETRY_TOKEN_PURPOSE in server/api/internal/webhook-deliveries/retry.post.ts.
const TOKEN_PURPOSE = 'webhook-retry-cron'

export default async function webhookRetry(): Promise<Response> {
  const secret = process.env.JWT_SECRET?.trim()
  const baseUrl = process.env.URL
  if (!secret || !baseUrl) {
    console.error('webhook-retry: JWT_SECRET and URL must be set')
    return new Response('not configured', { status: 500 })
  }

  const token = createHmac('sha256', secret).update(TOKEN_PURPOSE).digest('hex')
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/internal/webhook-deliveries/retry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`webhook-retry: HTTP ${res.status} ${body.slice(0, 300)}`)
  } else {
    console.log(`webhook-retry: ${body.slice(0, 300)}`)
  }
  return new Response(null, { status: res.ok ? 200 : 502 })
}

export const config = {
  schedule: '*/5 * * * *'
}
