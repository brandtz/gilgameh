import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { generateOpaqueToken, sha256Hex, verifyPassword, verifyPkceS256 } from '../utils/crypto'
import { Errors } from '../utils/errors'
import { signSessionJwt, type ActorContext } from '../utils/auth-context'
import { DEFAULT_AGENT_SCOPES, isValidScope, type Scope } from '../utils/scopes'
import { recordAudit } from './audit.service'

export async function loginWithPassword(email: string, password: string) {
  const db = await getDb()
  const [user] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email.toLowerCase().trim()), isNull(schema.users.deletedAt)))

  if (!user || !user.isActive) {
    throw Errors.unauthorized('Invalid email or password')
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw Errors.unauthorized('Invalid email or password')
  }

  // Find user's primary tenant membership
  const memberships = await db
    .select({
      tenantId: schema.tenantMemberships.tenantId,
      role: schema.tenantMemberships.role,
      tenantName: schema.tenants.name,
      tenantSlug: schema.tenants.slug
    })
    .from(schema.tenantMemberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
    .where(and(eq(schema.tenantMemberships.userId, user.id), isNull(schema.tenants.deletedAt)))

  if (memberships.length === 0) {
    throw Errors.forbidden('User has no active tenant membership')
  }

  const primary = memberships[0]
  const token = await signSessionJwt({
    sub: user.id,
    tid: primary.tenantId,
    role: user.role,
    name: user.name,
    email: user.email
  })

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    activeTenantId: primary.tenantId,
    tenants: memberships
  }
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function createApiKey(
  ctx: ActorContext,
  input: { name: string; scopes: Scope[]; expiresInDays?: number }
) {
  const db = await getDb()
  const rawKey = generateOpaqueToken('bo_key', 28)
  const keyPrefix = rawKey.slice(0, 14)
  const keyHash = sha256Hex(rawKey)
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000)
    : null

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        keyPrefix,
        keyHash,
        scopes: input.scopes,
        createdByUserId: ctx.userId ?? null,
        expiresAt
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: row.id,
      afterState: { id: row.id, name: row.name, keyPrefix, scopes: row.scopes }
    })

    return row
  })

  return {
    id: created.id,
    name: created.name,
    keyPrefix: created.keyPrefix,
    scopes: created.scopes,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
    // Plaintext key returned ONCE upon creation
    key: rawKey
  }
}

export async function listApiKeys(ctx: ActorContext) {
  const db = await getDb()
  return db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      scopes: schema.apiKeys.scopes,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      revokedAt: schema.apiKeys.revokedAt,
      expiresAt: schema.apiKeys.expiresAt,
      createdAt: schema.apiKeys.createdAt
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(schema.apiKeys.createdAt))
}

export async function revokeApiKey(ctx: ActorContext, id: string) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.tenantId, ctx.tenantId)))

    if (!existing) throw Errors.notFound('API key', id)

    const [updated] = await tx
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiKeys.id, id))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      beforeState: { revokedAt: existing.revokedAt },
      afterState: { revokedAt: updated.revokedAt }
    })

    return { id: updated.id, revokedAt: updated.revokedAt }
  })
}

// ── OAuth 2.1 Server (for MCP AI Agents) ──────────────────────────────────────

export async function registerOAuthClient(input: {
  name: string
  redirectUris: string[]
  requestedScopes?: string[]
}) {
  const db = await getDb()
  const clientId = generateOpaqueToken('bo_cli', 16)
  const allowedScopes =
    input.requestedScopes && input.requestedScopes.length > 0
      ? input.requestedScopes.filter(isValidScope)
      : [...DEFAULT_AGENT_SCOPES]

  const [client] = await db
    .insert(schema.oauthClients)
    .values({
      clientId,
      name: input.name,
      redirectUris: input.redirectUris,
      allowedScopes
    })
    .returning()

  return {
    client_id: client.clientId,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: allowedScopes.join(' ')
  }
}

export async function createOAuthAuthorizationCode(
  ctx: ActorContext,
  input: {
    clientId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod: 'S256'
    scopes: string[]
    tenantId?: string
  }
) {
  if (!ctx.userId) {
    throw Errors.forbidden('OAuth authorization must be approved by an authenticated user')
  }
  const db = await getDb()
  const [client] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, input.clientId))

  if (!client) {
    throw Errors.badRequest('Unknown OAuth client_id')
  }
  if (!client.redirectUris.includes(input.redirectUri)) {
    throw Errors.badRequest('redirect_uri is not registered for this client')
  }

  const targetTenantId = input.tenantId || ctx.tenantId
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, targetTenantId), isNull(schema.tenants.deletedAt)))
  if (!tenant) {
    throw Errors.notFound('Tenant', targetTenantId)
  }

  // Filter scopes to valid scopes (defaulting to read+draft agent scopes)
  const validScopes =
    input.scopes.length > 0
      ? input.scopes.filter(isValidScope)
      : [...DEFAULT_AGENT_SCOPES]

  const rawCode = generateOpaqueToken('bo_code', 24)
  const codeHash = sha256Hex(rawCode)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

  await db.transaction(async (tx) => {
    await tx.insert(schema.oauthAuthCodes).values({
      codeHash,
      clientId: client.clientId,
      userId: ctx.userId!,
      tenantId: targetTenantId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      scopes: validScopes,
      expiresAt
    })

    await recordAudit(tx, { ...ctx, tenantId: targetTenantId }, {
      action: 'oauth.code_issued',
      entityType: 'oauth_client',
      entityId: client.clientId,
      afterState: { clientId: client.clientId, scopes: validScopes }
    })
  })

  return { code: rawCode, scopes: validScopes }
}

export async function exchangeOAuthToken(input: {
  grantType: 'authorization_code' | 'refresh_token'
  clientId: string
  code?: string
  redirectUri?: string
  codeVerifier?: string
  refreshToken?: string
}) {
  const db = await getDb()

  if (input.grantType === 'authorization_code') {
    if (!input.code || !input.redirectUri || !input.codeVerifier) {
      throw Errors.badRequest('authorization_code grant requires code, redirect_uri, and code_verifier (PKCE)')
    }

    const codeHash = sha256Hex(input.code)
    const [authCode] = await db
      .select()
      .from(schema.oauthAuthCodes)
      .where(eq(schema.oauthAuthCodes.codeHash, codeHash))

    if (!authCode || authCode.consumedAt || authCode.expiresAt.getTime() < Date.now()) {
      throw Errors.unauthorized('Authorization code is invalid, expired, or already used')
    }
    if (authCode.clientId !== input.clientId || authCode.redirectUri !== input.redirectUri) {
      throw Errors.unauthorized('Client or redirect_uri mismatch')
    }
    if (!verifyPkceS256(input.codeVerifier, authCode.codeChallenge)) {
      throw Errors.unauthorized('PKCE code_verifier verification failed')
    }

    const [client] = await db
      .select()
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, input.clientId))

    const rawAccess = generateOpaqueToken('bo_at', 32)
    const rawRefresh = generateOpaqueToken('bo_rt', 32)
    const accessExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await db.transaction(async (tx) => {
      await tx
        .update(schema.oauthAuthCodes)
        .set({ consumedAt: new Date() })
        .where(eq(schema.oauthAuthCodes.id, authCode.id))

      await tx.insert(schema.oauthTokens).values([
        {
          tokenHash: sha256Hex(rawAccess),
          tokenType: 'access',
          clientId: authCode.clientId,
          userId: authCode.userId,
          tenantId: authCode.tenantId,
          name: client?.name || 'AI Agent',
          scopes: authCode.scopes,
          expiresAt: accessExpiresAt
        },
        {
          tokenHash: sha256Hex(rawRefresh),
          tokenType: 'refresh',
          clientId: authCode.clientId,
          userId: authCode.userId,
          tenantId: authCode.tenantId,
          name: client?.name || 'AI Agent',
          scopes: authCode.scopes,
          expiresAt: refreshExpiresAt
        }
      ])
    })

    return {
      access_token: rawAccess,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: rawRefresh,
      scope: (authCode.scopes || []).join(' ')
    }
  }

  // Refresh token grant
  if (!input.refreshToken) {
    throw Errors.badRequest('refresh_token is required')
  }
  const rtHash = sha256Hex(input.refreshToken)
  const [rt] = await db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.tokenHash, rtHash), eq(schema.oauthTokens.tokenType, 'refresh')))

  if (!rt || rt.revokedAt || rt.expiresAt.getTime() < Date.now() || rt.clientId !== input.clientId) {
    throw Errors.unauthorized('Refresh token is invalid, expired, or revoked')
  }

  const rawAccess = generateOpaqueToken('bo_at', 32)
  const accessExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await db.insert(schema.oauthTokens).values({
    tokenHash: sha256Hex(rawAccess),
    tokenType: 'access',
    clientId: rt.clientId,
    userId: rt.userId,
    tenantId: rt.tenantId,
    name: rt.name,
    scopes: rt.scopes,
    expiresAt: accessExpiresAt
  })

  return {
    access_token: rawAccess,
    token_type: 'Bearer',
    expires_in: 86400,
    scope: (rt.scopes || []).join(' ')
  }
}

export async function listOAuthTokens(ctx: ActorContext) {
  const db = await getDb()
  return db
    .select({
      id: schema.oauthTokens.id,
      tokenType: schema.oauthTokens.tokenType,
      clientId: schema.oauthTokens.clientId,
      name: schema.oauthTokens.name,
      scopes: schema.oauthTokens.scopes,
      expiresAt: schema.oauthTokens.expiresAt,
      revokedAt: schema.oauthTokens.revokedAt,
      lastUsedAt: schema.oauthTokens.lastUsedAt,
      createdAt: schema.oauthTokens.createdAt
    })
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.tenantId, ctx.tenantId), eq(schema.oauthTokens.tokenType, 'access')))
    .orderBy(desc(schema.oauthTokens.createdAt))
}

export async function revokeOAuthToken(ctx: ActorContext, tokenId: string) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.oauthTokens)
      .where(and(eq(schema.oauthTokens.id, tokenId), eq(schema.oauthTokens.tenantId, ctx.tenantId)))

    if (!existing) throw Errors.notFound('OAuth token', tokenId)

    const [updated] = await tx
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.oauthTokens.id, tokenId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'oauth.token_revoked',
      entityType: 'oauth_token',
      entityId: tokenId,
      beforeState: { revokedAt: existing.revokedAt },
      afterState: { revokedAt: updated.revokedAt }
    })

    return { id: updated.id, revokedAt: updated.revokedAt }
  })
}
