import type { H3Event } from 'h3'
import { getCookie, getHeader } from 'h3'
import { SignJWT, jwtVerify } from 'jose'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { sha256Hex } from './crypto'
import { Errors } from './errors'
import { getScopesForRole, hasAllScopes, type Scope } from './scopes'

export type ActorType = 'operator' | 'user' | 'agent' | 'integration' | 'system'

export interface ActorContext {
  actorType: ActorType
  actorId: string
  actorLabel: string
  userId?: string
  tenantId: string
  role?: string
  scopes: Scope[]
  requestId?: string
  tokenId?: string
}

function getJwtSecretBytes(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production')
    }
    return new TextEncoder().encode('dev-insecure-jwt-secret-change-in-production-32bytes')
  }
  return new TextEncoder().encode(secret)
}

function getJwtIssuer(): string {
  return process.env.JWT_ISSUER || 'back-office-platform'
}

export async function signSessionJwt(payload: {
  sub: string
  tid: string
  role: string
  name: string
  email: string
}): Promise<string> {
  return new SignJWT({
    tid: payload.tid,
    role: payload.role,
    name: payload.name,
    email: payload.email
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(getJwtIssuer())
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(getJwtSecretBytes())
}

export async function verifySessionJwt(token: string): Promise<{
  sub: string
  tid: string
  role: string
  name: string
  email: string
}> {
  const { payload } = await jwtVerify(token, getJwtSecretBytes(), {
    issuer: getJwtIssuer()
  })
  if (!payload.sub || typeof payload.tid !== 'string' || typeof payload.role !== 'string') {
    throw Errors.unauthorized('Invalid session token claims')
  }
  return {
    sub: payload.sub,
    tid: payload.tid,
    role: payload.role,
    name: String(payload.name || payload.email || payload.sub),
    email: String(payload.email || '')
  }
}

/**
 * Resolves authentication from Authorization Bearer (JWT, OAuth agent token, or API key)
 * or HttpOnly session cookie. Enforces tenant isolation from auth context ONLY.
 */
export async function resolveAuthFromToken(
  token: string,
  overrideTenantId?: string,
  requestId?: string
): Promise<ActorContext> {
  const db = await getDb()

  // 1. OAuth 2.1 Agent Access Token (bo_at_...)
  if (token.startsWith('bo_at_')) {
    const tokenHash = sha256Hex(token)
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(and(eq(schema.oauthTokens.tokenHash, tokenHash), eq(schema.oauthTokens.tokenType, 'access')))

    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw Errors.unauthorized('Agent access token is invalid, expired, or revoked')
    }

    await db
      .update(schema.oauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.oauthTokens.id, row.id))

    return {
      actorType: 'agent',
      actorId: row.id,
      actorLabel: `${row.name} (${row.clientId})`,
      userId: row.userId,
      tenantId: row.tenantId,
      scopes: (row.scopes || []) as Scope[],
      requestId,
      tokenId: row.id
    }
  }

  // 2. Integration API Key (bo_key_...)
  if (token.startsWith('bo_key_')) {
    const keyHash = sha256Hex(token)
    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash))

    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
      throw Errors.unauthorized('API key is invalid, expired, or revoked')
    }

    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, row.id))

    return {
      actorType: 'integration',
      actorId: row.id,
      actorLabel: `API Key: ${row.name}`,
      tenantId: row.tenantId,
      scopes: (row.scopes || []) as Scope[],
      requestId
    }
  }

  // 3. Session JWT (Operator or Tenant User)
  let claims
  try {
    claims = await verifySessionJwt(token)
  } catch {
    throw Errors.unauthorized('Invalid or expired session token')
  }

  let tenantId = claims.tid
  const isOperator = claims.role === 'bwe_operator'
  let effectiveRole = claims.role
  let customScopes: Scope[] | null = null

  // Resolve requested tenant (either override header or JWT default) and verify membership strictly
  const requestedTenantId = overrideTenantId || tenantId
  if (isOperator) {
    if (overrideTenantId && overrideTenantId !== tenantId) {
      const [targetTenant] = await db
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(and(eq(schema.tenants.id, overrideTenantId), isNull(schema.tenants.deletedAt)))
      if (!targetTenant) {
        throw Errors.notFound('Tenant', overrideTenantId)
      }
      tenantId = targetTenant.id
    }
  } else {
    // Non-operators may ONLY access tenants where they hold an active tenant_memberships row
    const [membership] = await db
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.userId, claims.sub),
          eq(schema.tenantMemberships.tenantId, requestedTenantId),
          isNull(schema.tenantMemberships.deletedAt)
        )
      )
    if (!membership) {
      throw Errors.forbidden('You do not have permission to access this business workspace')
    }
    tenantId = membership.tenantId
    effectiveRole = membership.role
    if (Array.isArray(membership.scopes) && membership.scopes.length > 0) {
      customScopes = membership.scopes as Scope[]
    }
  }

  return {
    actorType: isOperator ? 'operator' : 'user',
    actorId: claims.sub,
    actorLabel: claims.name,
    userId: claims.sub,
    tenantId,
    role: effectiveRole,
    scopes: customScopes ?? getScopesForRole(effectiveRole),
    requestId
  }
}

export async function requireAuth(
  event: H3Event,
  requiredScopes: Scope[] = []
): Promise<ActorContext> {
  const authHeader = getHeader(event, 'authorization')
  const apiKeyHeader = getHeader(event, 'x-api-key')
  const cookieToken = getCookie(event, 'bo_session')
  const overrideTenantId = getHeader(event, 'x-tenant-id') || undefined
  const requestId = (event.context.requestId as string | undefined) || undefined

  let token = ''
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim()
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim()
  } else if (cookieToken) {
    token = cookieToken.trim()
  }

  if (!token) {
    throw Errors.unauthorized('Missing authentication credentials')
  }

  const ctx = await resolveAuthFromToken(token, overrideTenantId, requestId)

  if (requiredScopes.length > 0 && !hasAllScopes(ctx.scopes, requiredScopes)) {
    throw Errors.forbidden(`Missing required scope(s): ${requiredScopes.join(', ')}`, {
      requiredScopes
    })
  }

  event.context.actor = ctx
  return ctx
}

/**
 * Enforces the tenant-level opt-in policy for agent approval scopes.
 * Even if an agent token holds an approve scope, approval is blocked unless the tenant opted in.
 */
export function enforceAgentApprovalPolicy(
  ctx: ActorContext,
  tenantSettings: { allowAgentApproveScopes: boolean },
  approvalPath: string
): void {
  if (ctx.actorType === 'agent' && !tenantSettings.allowAgentApproveScopes) {
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'
    throw Errors.approvalRequiredInUi(
      'This tenant requires human approval in the web UI rather than via an AI agent token.',
      `${baseUrl}${approvalPath}`
    )
  }
}
