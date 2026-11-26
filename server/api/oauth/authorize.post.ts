import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../utils/errors'
import { requireAuth } from '../../utils/auth-context'
import { oauthApproveSchema } from '../../schemas'
import { createOAuthAuthorizationCode } from '../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const body = oauthApproveSchema.parse(await readBody(event))
    const scopes = body.scope ? body.scope.split(/\s+/).filter(Boolean) : []

    const { code, scopes: grantedScopes } = await createOAuthAuthorizationCode(ctx, {
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      scopes,
      tenantId: body.tenant_id
    })

    const redirectUrl = new URL(body.redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (body.state) redirectUrl.searchParams.set('state', body.state)

    return {
      data: {
        code,
        scopes: grantedScopes,
        redirectTo: redirectUrl.toString()
      }
    }
  })
)
