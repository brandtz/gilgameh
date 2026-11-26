import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getDb, schema } from '../db'
import { sha256Hex } from '../utils/crypto'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

function getR2Client(): { client: S3Client; bucket: string } | null {
  if (process.env.STORAGE_DRIVER !== 'r2') return null
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  })
  return { client, bucket }
}

function getLocalStorageRoot(): string {
  return resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || '.data/uploads')
}

export async function storeAttachment(
  ctx: ActorContext,
  input: {
    entityType: string
    entityId?: string | null
    filename: string
    mimeType: string
    data: Buffer | Uint8Array
  }
) {
  const buf = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data)
  if (buf.length === 0) {
    throw Errors.badRequest('Attachment content cannot be empty')
  }
  if (buf.length > 25 * 1024 * 1024) {
    throw Errors.badRequest('Attachment exceeds 25MB limit')
  }

  const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storageKey = `${ctx.tenantId}/${input.entityType}/${randomUUID()}-${safeFilename}`
  const hash = sha256Hex(buf)

  const r2 = getR2Client()
  if (r2) {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: storageKey,
        Body: buf,
        ContentType: input.mimeType
      })
    )
  } else {
    const filePath = resolve(getLocalStorageRoot(), storageKey)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, buf)
  }

  const db = await getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.attachments)
      .values({
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        filename: safeFilename,
        mimeType: input.mimeType,
        sizeBytes: buf.length,
        storageKey,
        sha256: hash,
        createdByActorType: ctx.actorType,
        createdByActorId: ctx.actorId
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'attachment.created',
      entityType: 'attachment',
      entityId: row.id,
      afterState: {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes
      }
    })

    return row
  })
}

export async function getAttachmentWithBytes(tenantId: string, attachmentId: string) {
  const db = await getDb()
  const [row] = await db
    .select()
    .from(schema.attachments)
    .where(
      and(
        eq(schema.attachments.id, attachmentId),
        eq(schema.attachments.tenantId, tenantId),
        isNull(schema.attachments.deletedAt)
      )
    )
  if (!row) throw Errors.notFound('Attachment', attachmentId)

  const r2 = getR2Client()
  let bytes: Buffer
  if (r2) {
    const res = await r2.client.send(
      new GetObjectCommand({ Bucket: r2.bucket, Key: row.storageKey })
    )
    const arr = await res.Body?.transformToByteArray()
    if (!arr) throw Errors.notFound('Attachment content', attachmentId)
    bytes = Buffer.from(arr)
  } else {
    const filePath = resolve(getLocalStorageRoot(), row.storageKey)
    bytes = await readFile(filePath)
  }

  return { attachment: row, bytes }
}
