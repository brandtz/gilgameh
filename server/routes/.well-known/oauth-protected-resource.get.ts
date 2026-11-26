import { defineEventHandler } from 'h3'
import { DEFAULT_AGENT_SCOPES } from '../../utils/scopes'

export default defineEventHandler(() => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: DEFAULT_AGENT_SCOPES
  }
})
