import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { changePasswordSchema } from '../../../schemas'
import { changeUserPassword } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const body = changePasswordSchema.parse(await readBody(event))
    const result = await changeUserPassword(ctx, body.currentPassword, body.newPassword)
    return { data: result }
  })
)
