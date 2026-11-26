import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expectedHex] = parts
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  const expected = Buffer.from(expectedHex, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

export function generateOpaqueToken(prefix: string, byteLength = 32): string {
  return `${prefix}_${randomBytes(byteLength).toString('base64url')}`
}

export function signHmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyHmacSha256(secret: string, payload: string, providedHex: string): boolean {
  const expected = signHmacSha256(secret, payload)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(providedHex.trim(), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  const computed = sha256Base64Url(codeVerifier)
  const a = Buffer.from(computed, 'utf8')
  const b = Buffer.from(expectedChallenge, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function computeExpenseFingerprint(
  tenantId: string,
  vendor: string,
  expenseDate: string,
  totalCents: number
): string {
  const normalized = `${tenantId}|${vendor.trim().toLowerCase()}|${expenseDate.trim()}|${totalCents}`
  return sha256Hex(normalized)
}
