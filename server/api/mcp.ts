import { defineEventHandler, getHeader, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireAuth, type ActorContext } from '../utils/auth-context'
import { createMcpServerForActor, emailQuoteCopyInputSchema } from '../services/mcp.service'
import { AppError } from '../utils/errors'
import {
  buildInsufficientScopeMessage,
  getMissingScopesForMcpTool
} from '../utils/mcp-scopes'

export interface McpScopeCheckResult {
  allowed: boolean
  statusCode?: number
  wwwAuthenticate?: string
  body?: Record<string, unknown>
}

/**
 * Inspects JSON-RPC `tools/call` payloads before executing the tool so:
 * 1. Missing scopes return HTTP 403 + RFC 6750/9728 `WWW-Authenticate: Bearer error="insufficient_scope"`
 * 2. Strict-schema tools like `email_quote_copy` reject unknown fields (`to`, `cc`, `bcc`, etc.)
 */
export function evaluateMcpScopeAccess(
  rpcBody: unknown,
  ctx: ActorContext,
  baseUrl: string
): McpScopeCheckResult {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const checkSingle = (msg: any): McpScopeCheckResult | null => {
    if (!msg || typeof msg !== 'object' || msg.method !== 'tools/call') return null
    const toolName = msg.params?.name
    if (typeof toolName !== 'string') return null

    const missing = getMissingScopesForMcpTool(toolName, ctx.scopes)
    if (missing.length > 0) {
      const needed = missing.join(' ')
      const friendly = buildInsufficientScopeMessage(missing)
      return {
        allowed: false,
        statusCode: 403,
        wwwAuthenticate: `Bearer error="insufficient_scope", scope="${needed}", resource_metadata="${cleanBase}/.well-known/oauth-protected-resource"`,
        body: {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          error: {
            code: -32003,
            message: friendly,
            data: {
              code: 'INSUFFICIENT_SCOPE',
              requiredScopes: missing
            }
          }
        }
      }
    }

    // Enforce additionalProperties: false strictly for email_quote_copy (blocks `to`, `cc`, `bcc`, etc.)
    if (toolName === 'email_quote_copy') {
      const parsed = emailQuoteCopyInputSchema.safeParse(msg.params?.arguments ?? {})
      if (!parsed.success) {
        return {
          allowed: false,
          statusCode: 400,
          body: {
            jsonrpc: '2.0',
            id: msg.id ?? null,
            error: {
              code: -32602,
              message: `Invalid arguments for email_quote_copy: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
              data: { code: 'VALIDATION_ERROR' }
            }
          }
        }
      }
    }

    return null
  }

  if (Array.isArray(rpcBody)) {
    for (const item of rpcBody) {
      const denied = checkSingle(item)
      if (denied) return denied
    }
  } else {
    const denied = checkSingle(rpcBody)
    if (denied) return denied
  }

  return { allowed: true }
}

/**
 * MCP Streamable HTTP endpoint (/api/mcp).
 * Authenticated via OAuth 2.1 Bearer token (or Session JWT / API key).
 * Returns RFC 9728 WWW-Authenticate resource_metadata challenge when unauthenticated,
 * and HTTP 403 with `insufficient_scope` when a tool requires a scope not on the token.
 */
export default defineEventHandler(async (event) => {
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  let ctx: ActorContext
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

  const body = event.method === 'POST' ? await readBody(event) : undefined

  if (event.method === 'POST' && body) {
    const scopeCheck = evaluateMcpScopeAccess(body, ctx, baseUrl)
    if (!scopeCheck.allowed) {
      setResponseStatus(event, scopeCheck.statusCode || 403)
      if (scopeCheck.wwwAuthenticate) {
        setResponseHeader(event, 'WWW-Authenticate', scopeCheck.wwwAuthenticate)
      }
      return scopeCheck.body
    }
  }

  const server = createMcpServerForActor(ctx)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // Stateless serverless-compatible mode (Vercel / Netlify)
  })

  await server.connect(transport)

  if (!getHeader(event, 'accept')) {
    event.node.req.headers.accept = 'application/json, text/event-stream'
  }

  await transport.handleRequest(event.node.req, event.node.res, body)
  await server.close()
  return null
})
