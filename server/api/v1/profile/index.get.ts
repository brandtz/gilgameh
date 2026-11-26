import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getUserProfile } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const profile = await getUserProfile(ctx)
    return { data: profile }
  })
)
