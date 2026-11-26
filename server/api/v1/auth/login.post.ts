import { defineEventHandler, readBody, setCookie } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { loginSchema } from '../../../schemas'
import { loginWithPassword } from '../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const body = loginSchema.parse(await readBody(event))
    const result = await loginWithPassword(body.email, body.password)

    setCookie(event, 'bo_session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12
    })

    return { data: result }
  })
)
