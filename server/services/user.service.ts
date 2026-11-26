import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { hashPassword, verifyPassword } from '../utils/crypto'
import { Errors } from '../utils/errors'
import { getScopesForRole, type Scope } from '../utils/scopes'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

// ── Current User Profile Management ───────────────────────────────────────────

export async function getUserProfile(ctx: ActorContext) {
  if (!ctx.userId) {
    throw Errors.forbidden('Profile management is only available to signed-in users')
  }
  const db = await getDb()
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      phone: schema.users.phone,
      title: schema.users.title,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, ctx.userId), isNull(schema.users.deletedAt)))

  if (!user) throw Errors.notFound('User', ctx.userId)
  return user
}

export async function updateUserProfile(
  ctx: ActorContext,
  patch: {
    name?: string
    email?: string
    phone?: string | null
    title?: string | null
  }
) {
  if (!ctx.userId) {
    throw Errors.forbidden('Profile updates are only available to signed-in users')
  }
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, ctx.userId!), isNull(schema.users.deletedAt)))
    if (!existing) throw Errors.notFound('User', ctx.userId!)

    const normalizedEmail = patch.email ? patch.email.trim().toLowerCase() : undefined
    if (normalizedEmail && normalizedEmail !== existing.email) {
      const [conflict] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, normalizedEmail))
      if (conflict) {
        throw Errors.conflict(`Email "${normalizedEmail}" is already in use`)
      }
    }

    const [updated] = await tx
      .update(schema.users)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        updatedAt: new Date()
      })
      .where(eq(schema.users.id, existing.id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        phone: schema.users.phone,
        title: schema.users.title,
        role: schema.users.role,
        updatedAt: schema.users.updatedAt
      })

    await recordAudit(tx, ctx, {
      action: 'user.profile_updated',
      entityType: 'user',
      entityId: existing.id,
      beforeState: { name: existing.name, email: existing.email, phone: existing.phone, title: existing.title },
      afterState: { name: updated.name, email: updated.email, phone: updated.phone, title: updated.title }
    })

    return updated
  })
}

export async function changeUserPassword(
  ctx: ActorContext,
  currentPassword: string,
  newPassword: string
) {
  if (!ctx.userId) {
    throw Errors.forbidden('Password change is only available to signed-in users')
  }
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, ctx.userId!), isNull(schema.users.deletedAt)))
    if (!user) throw Errors.notFound('User', ctx.userId!)

    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) {
      throw Errors.unauthorized('Current password is incorrect')
    }

    const newHash = await hashPassword(newPassword)
    await tx
      .update(schema.users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))

    await recordAudit(tx, ctx, {
      action: 'user.password_changed',
      entityType: 'user',
      entityId: user.id
    })

    return { changed: true }
  })
}

// ── Tenant Team & RBAC Management ─────────────────────────────────────────────

export async function listTenantMembers(ctx: ActorContext) {
  const db = await getDb()
  const rows = await db
    .select({
      membershipId: schema.tenantMemberships.id,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      phone: schema.users.phone,
      title: schema.users.title,
      platformRole: schema.users.role,
      isActive: schema.users.isActive,
      role: schema.tenantMemberships.role,
      customScopes: schema.tenantMemberships.scopes,
      createdAt: schema.tenantMemberships.createdAt
    })
    .from(schema.tenantMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
    .where(
      and(
        eq(schema.tenantMemberships.tenantId, ctx.tenantId),
        isNull(schema.tenantMemberships.deletedAt),
        isNull(schema.users.deletedAt)
      )
    )
    .orderBy(desc(schema.tenantMemberships.createdAt))

  return rows.map((r) => ({
    ...r,
    effectiveScopes:
      Array.isArray(r.customScopes) && r.customScopes.length > 0
        ? (r.customScopes as Scope[])
        : getScopesForRole(r.role)
  }))
}

export async function addTenantMember(
  ctx: ActorContext,
  input: {
    email: string
    name: string
    phone?: string | null
    title?: string | null
    password?: string
    role: 'owner' | 'manager' | 'staff' | 'viewer' | 'operator'
    scopes?: Scope[] | null
  }
) {
  // Only BWE operators can grant 'operator' role
  if (input.role === 'operator' && ctx.actorType !== 'operator') {
    throw Errors.forbidden('Only BWE operators can assign the platform operator role')
  }

  const db = await getDb()
  const normalizedEmail = input.email.trim().toLowerCase()

  return db.transaction(async (tx) => {
    let [user] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, normalizedEmail), isNull(schema.users.deletedAt)))

    if (!user) {
      if (!input.password) {
        throw Errors.validation('Password (min 10 characters) is required when creating a new user account')
      }
      const platformRole =
        input.role === 'operator'
          ? 'bwe_operator'
          : input.role === 'owner'
            ? 'tenant_owner'
            : 'tenant_staff'

      ;[user] = await tx
        .insert(schema.users)
        .values({
          email: normalizedEmail,
          passwordHash: await hashPassword(input.password),
          name: input.name.trim(),
          phone: input.phone ?? null,
          title: input.title ?? null,
          role: platformRole,
          isActive: true
        })
        .returning()
    }

    const [existingMembership] = await tx
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, ctx.tenantId),
          eq(schema.tenantMemberships.userId, user.id)
        )
      )

    let membership
    if (existingMembership) {
      ;[membership] = await tx
        .update(schema.tenantMemberships)
        .set({
          role: input.role,
          scopes: input.scopes ?? null,
          deletedAt: null,
          updatedAt: new Date()
        })
        .where(eq(schema.tenantMemberships.id, existingMembership.id))
        .returning()
    } else {
      ;[membership] = await tx
        .insert(schema.tenantMemberships)
        .values({
          tenantId: ctx.tenantId,
          userId: user.id,
          role: input.role,
          scopes: input.scopes ?? null
        })
        .returning()
    }

    await recordAudit(tx, ctx, {
      action: 'team.member_added',
      entityType: 'tenant_membership',
      entityId: membership.id,
      afterState: {
        userId: user.id,
        email: user.email,
        role: membership.role,
        scopes: membership.scopes
      }
    })

    return {
      membershipId: membership.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      title: user.title,
      role: membership.role,
      customScopes: membership.scopes,
      effectiveScopes:
        Array.isArray(membership.scopes) && membership.scopes.length > 0
          ? membership.scopes
          : getScopesForRole(membership.role)
    }
  })
}

export async function updateTenantMember(
  ctx: ActorContext,
  membershipId: string,
  patch: {
    role?: 'owner' | 'manager' | 'staff' | 'viewer' | 'operator'
    scopes?: Scope[] | null
    isActive?: boolean
  }
) {
  if (patch.role === 'operator' && ctx.actorType !== 'operator') {
    throw Errors.forbidden('Only BWE operators can assign the platform operator role')
  }
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.id, membershipId),
          eq(schema.tenantMemberships.tenantId, ctx.tenantId),
          isNull(schema.tenantMemberships.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Team membership', membershipId)

    const [updated] = await tx
      .update(schema.tenantMemberships)
      .set({
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
        updatedAt: new Date()
      })
      .where(eq(schema.tenantMemberships.id, membershipId))
      .returning()

    if (patch.isActive !== undefined && existing.userId !== ctx.userId) {
      await tx
        .update(schema.users)
        .set({ isActive: patch.isActive, updatedAt: new Date() })
        .where(eq(schema.users.id, existing.userId))
    }

    await recordAudit(tx, ctx, {
      action: 'team.member_updated',
      entityType: 'tenant_membership',
      entityId: membershipId,
      beforeState: { role: existing.role, scopes: existing.scopes },
      afterState: { role: updated.role, scopes: updated.scopes, isActive: patch.isActive }
    })

    return {
      membershipId: updated.id,
      role: updated.role,
      customScopes: updated.scopes,
      effectiveScopes:
        Array.isArray(updated.scopes) && updated.scopes.length > 0
          ? updated.scopes
          : getScopesForRole(updated.role)
    }
  })
}

export async function removeTenantMember(ctx: ActorContext, membershipId: string) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.id, membershipId),
          eq(schema.tenantMemberships.tenantId, ctx.tenantId),
          isNull(schema.tenantMemberships.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Team membership', membershipId)
    if (existing.userId === ctx.userId) {
      throw Errors.conflict('You cannot remove your own membership from the active workspace')
    }

    await tx
      .update(schema.tenantMemberships)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.tenantMemberships.id, membershipId))

    await recordAudit(tx, ctx, {
      action: 'team.member_removed',
      entityType: 'tenant_membership',
      entityId: membershipId,
      beforeState: { userId: existing.userId, role: existing.role }
    })

    return { removed: true }
  })
}
