import { defineEventHandler } from 'h3'
import { buildOAuthProtectedResourceMetadata } from '../../../../utils/mcp-scopes'

/**
 * RFC 9728 path-specific protected-resource metadata for /api/mcp.
 * Returns the exact same document as /.well-known/oauth-protected-resource.
 */
export default defineEventHandler(() => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  return buildOAuthProtectedResourceMetadata(baseUrl)
})
