import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../utils/errors'
import { oauthTokenSchema } from '../../schemas'
import { exchangeOAuthToken } from '../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const body = oauthTokenSchema.parse(await readBody(event))
    return exchangeOAuthToken({
      grantType: body.grant_type,
      clientId: body.client_id,
      code: body.code,
      redirectUri: body.redirect_uri,
      codeVerifier: body.code_verifier,
      refreshToken: body.refresh_token
    })
  })
)
