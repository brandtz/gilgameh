import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../../../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    setResponseStatus(event, 404)
    return null
  }

  const db = await getDb()
  const [tenant] = await db
    .select({ branding: schema.tenants.branding })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, id), isNull(schema.tenants.deletedAt)))

  const dataUrl = tenant?.branding?.logoDataUrl
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    setResponseStatus(event, 404)
    return null
  }

  const [meta, b64] = dataUrl.split(',')
  if (!b64) {
    setResponseStatus(event, 404)
    return null
  }
  const mime = meta.includes('jpeg') || meta.includes('jpg') ? 'image/jpeg' : 'image/png'
  setResponseHeader(event, 'Content-Type', mime)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return Buffer.from(b64, 'base64')
})
