import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateProfileSchema } from '../../../schemas'
import { updateUserProfile } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const body = updateProfileSchema.parse(await readBody(event))
    const updated = await updateUserProfile(ctx, body)
    return { data: updated }
  })
)
