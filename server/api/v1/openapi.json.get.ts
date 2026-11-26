import { defineEventHandler } from 'h3'
import { buildOpenApiSpec } from '../../services/openapi.service'

export default defineEventHandler(() => {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
  return buildOpenApiSpec(baseUrl)
})
