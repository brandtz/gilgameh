import { defineEventHandler, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'
import { sha256Hex } from '../../utils/crypto'
import { defineApiHandler, Errors } from '../../utils/errors'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const body = (await readBody(event)) as { token?: string }
    if (!body?.token) throw Errors.badRequest('token is required')
    const db = await getDb()
    await db
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.tokenHash, sha256Hex(body.token)))
    return { revoked: true }
  })
)
