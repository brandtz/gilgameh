import { SignJWT, jwtVerify } from 'jose'
import { Errors } from './errors'

function getPdfSigningKey(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production')
    }
    return new TextEncoder().encode('dev-insecure-jwt-secret-change-in-production-32bytes')
  }
  return new TextEncoder().encode(secret)
}

export interface SignedPdfPayload {
  tenantId: string
  docType: 'quote' | 'invoice'
  docId: string
}

/**
 * Creates a cryptographically signed, read-only, time-limited token scoped
 * to ONE specific quote or invoice PDF in ONE tenant so owners can open or
 * share the PDF directly from Claude/ChatGPT or mobile email without logging in.
 */
export async function signDocumentPdfToken(
  payload: SignedPdfPayload,
  expiresIn = '7d'
): Promise<string> {
  return new SignJWT({
    purpose: 'bo_pdf_share',
    tid: payload.tenantId,
    dt: payload.docType,
    did: payload.docId
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getPdfSigningKey())
}

export async function verifyDocumentPdfToken(token: string): Promise<SignedPdfPayload> {
  try {
    const { payload } = await jwtVerify(token, getPdfSigningKey())
    if (
      payload.purpose !== 'bo_pdf_share' ||
      typeof payload.tid !== 'string' ||
      (payload.dt !== 'quote' && payload.dt !== 'invoice') ||
      typeof payload.did !== 'string'
    ) {
      throw Errors.unauthorized('Invalid PDF share token')
    }
    return {
      tenantId: payload.tid,
      docType: payload.dt,
      docId: payload.did
    }
  } catch {
    throw Errors.unauthorized('PDF download link is invalid or expired')
  }
}

export async function buildShareablePdfUrl(
  baseUrl: string,
  payload: SignedPdfPayload
): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const token = await signDocumentPdfToken(payload)
  return `${cleanBase}/api/v1/public/pdf?token=${encodeURIComponent(token)}`
}
