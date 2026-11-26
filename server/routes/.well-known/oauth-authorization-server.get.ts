import { defineEventHandler } from 'h3'
import { MCP_SCOPES_SUPPORTED } from '../../utils/mcp-scopes'

export default defineEventHandler(() => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    revocation_endpoint: `${baseUrl}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SCOPES_SUPPORTED]
  }
})
