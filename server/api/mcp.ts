import { defineEventHandler, getHeader, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireAuth } from '../utils/auth-context'
import { createMcpServerForActor } from '../services/mcp.service'
import { AppError } from '../utils/errors'

/**
 * MCP Streamable HTTP endpoint (/api/mcp).
 * Authenticated via OAuth 2.1 Bearer token (or Session JWT / API key).
 * Returns RFC 9728 WWW-Authenticate resource_metadata challenge when unauthenticated.
 */
export default defineEventHandler(async (event) => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  let ctx
  try {
    ctx = await requireAuth(event)
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) {
      setResponseStatus(event, 401)
      setResponseHeader(
        event,
        'WWW-Authenticate',
        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
      )
      return {
        error: {
          code: 'UNAUTHORIZED',
          message: 'OAuth 2.1 Bearer token required for MCP endpoint'
        }
      }
    }
    throw err
  }

  const server = createMcpServerForActor(ctx)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // Stateless serverless-compatible mode (Vercel / Netlify)
  })

  await server.connect(transport)

  const body = event.method === 'POST' ? await readBody(event) : undefined
  // Ensure Accept header includes JSON + SSE for StreamableHTTPServerTransport compatibility
  if (!getHeader(event, 'accept')) {
    event.node.req.headers.accept = 'application/json, text/event-stream'
  }

  await transport.handleRequest(event.node.req, event.node.res, body)
  await server.close()
  return null
})
