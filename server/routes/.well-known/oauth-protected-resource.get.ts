import { defineEventHandler } from 'h3'
import { buildOAuthProtectedResourceMetadata } from '../../utils/mcp-scopes'

export default defineEventHandler(() => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  return buildOAuthProtectedResourceMetadata(baseUrl)
})
