import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../utils/errors'
import { oauthRegisterClientSchema } from '../../schemas'
import { registerOAuthClient } from '../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const body = oauthRegisterClientSchema.parse(await readBody(event))
    return registerOAuthClient({
      name: body.client_name || body.name || 'MCP Agent Client',
      redirectUris: body.redirect_uris,
      requestedScopes: body.scope ? body.scope.split(/\s+/).filter(Boolean) : undefined
    })
  })
)
