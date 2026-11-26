import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { createCustomer, updateCustomer } from './customer.service'

interface ChatwootTenantConfig {
  isEnabled: boolean
  baseUrl: string
  accountId: string
  apiToken: string
  hasApiToken: boolean
  hasWebhookSecret: boolean
}

async function getRawChatwootConfig(tenantId: string) {
  const db = await getDb()
  const [row] = await db
    .select()
    .from(schema.integrationConfigs)
    .where(
      and(
        eq(schema.integrationConfigs.tenantId, tenantId),
        eq(schema.integrationConfigs.provider, 'chatwoot')
      )
    )
  return row ?? null
}

export async function getTenantChatwootConfig(ctx: ActorContext): Promise<ChatwootTenantConfig> {
  const row = await getRawChatwootConfig(ctx.tenantId)
  const cfg = (row?.config || {}) as Record<string, unknown>
  return {
    isEnabled: Boolean(row?.isEnabled),
    baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '',
    accountId: typeof cfg.accountId === 'string' ? cfg.accountId : '',
    apiToken: '', // Never expose stored token back to UI
    hasApiToken: Boolean(cfg.apiToken),
    hasWebhookSecret: Boolean(row?.webhookSecret)
  }
}

export async function saveTenantChatwootConfig(
  ctx: ActorContext,
  input: {
    isEnabled: boolean
    baseUrl?: string
    accountId?: string
    apiToken?: string
    webhookSecret?: string | null
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.integrationConfigs)
      .where(
        and(
          eq(schema.integrationConfigs.tenantId, ctx.tenantId),
          eq(schema.integrationConfigs.provider, 'chatwoot')
        )
      )

    const prevCfg = (existing?.config || {}) as Record<string, unknown>
    const nextCfg: Record<string, unknown> = {
      baseUrl: input.baseUrl !== undefined ? input.baseUrl.replace(/\/+$/, '') : (prevCfg.baseUrl || ''),
      accountId: input.accountId !== undefined ? input.accountId.trim() : (prevCfg.accountId || ''),
      apiToken: input.apiToken ? input.apiToken.trim() : (prevCfg.apiToken || '')
    }

    let saved
    if (existing) {
      ;[saved] = await tx
        .update(schema.integrationConfigs)
        .set({
          isEnabled: input.isEnabled,
          config: nextCfg,
          ...(input.webhookSecret !== undefined ? { webhookSecret: input.webhookSecret } : {}),
          updatedAt: new Date()
        })
        .where(eq(schema.integrationConfigs.id, existing.id))
        .returning()
    } else {
      ;[saved] = await tx
        .insert(schema.integrationConfigs)
        .values({
          tenantId: ctx.tenantId,
          provider: 'chatwoot',
          isEnabled: input.isEnabled,
          config: nextCfg,
          webhookSecret: input.webhookSecret ?? null
        })
        .returning()
    }

    await recordAudit(tx, ctx, {
      action: 'chatwoot.config_updated',
      entityType: 'integration_config',
      entityId: saved.id,
      afterState: { isEnabled: saved.isEnabled, baseUrl: nextCfg.baseUrl, accountId: nextCfg.accountId }
    })

    return {
      isEnabled: Boolean(saved.isEnabled),
      baseUrl: String(nextCfg.baseUrl || ''),
      accountId: String(nextCfg.accountId || ''),
      apiToken: '',
      hasApiToken: Boolean(nextCfg.apiToken),
      hasWebhookSecret: Boolean(saved.webhookSecret)
    }
  })
}

async function chatwootApiRequest(tenantId: string, path: string, init: RequestInit = {}) {
  const row = await getRawChatwootConfig(tenantId)
  const cfg = (row?.config || {}) as Record<string, unknown>
  const baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.replace(/\/+$/, '') : ''
  const accountId = typeof cfg.accountId === 'string' ? cfg.accountId.trim() : ''
  const apiToken = typeof cfg.apiToken === 'string' ? cfg.apiToken.trim() : ''

  if (!row?.isEnabled || !baseUrl || !accountId || !apiToken) {
    return null
  }

  const res = await fetch(`${baseUrl}/api/v1/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      api_access_token: apiToken,
      ...(init.headers || {})
    }
  })

  if (!res.ok) {
    throw Errors.badRequest(`Chatwoot API returned HTTP ${res.status}`)
  }
  return res.json()
}

export async function listTenantChatwootData(ctx: ActorContext) {
  const db = await getDb()
  const [config, contacts, conversations] = await Promise.all([
    getTenantChatwootConfig(ctx),
    db
      .select()
      .from(schema.chatwootContacts)
      .where(eq(schema.chatwootContacts.tenantId, ctx.tenantId))
      .orderBy(desc(schema.chatwootContacts.updatedAt)),
    db
      .select({
        conversation: schema.chatwootConversations,
        contact: schema.chatwootContacts
      })
      .from(schema.chatwootConversations)
      .innerJoin(
        schema.chatwootContacts,
        eq(schema.chatwootContacts.id, schema.chatwootConversations.chatwootContactId)
      )
      .where(eq(schema.chatwootConversations.tenantId, ctx.tenantId))
      .orderBy(desc(schema.chatwootConversations.lastMessageAt))
  ])

  return {
    config,
    contacts,
    conversations: conversations.map((r) => ({
      ...r.conversation,
      contact: r.contact
    }))
  }
}

/**
 * Pulls contacts & open conversations from the active tenant's own Chatwoot instance.
 * Strictly tenant-isolated: uses only ctx.tenantId's saved credentials and writes only to ctx.tenantId.
 */
export async function syncTenantChatwoot(ctx: ActorContext) {
  const contactsRes = await chatwootApiRequest(ctx.tenantId, '/contacts')
  const convosRes = await chatwootApiRequest(ctx.tenantId, '/conversations?status=all')

  if (!contactsRes || !convosRes) {
    throw Errors.badRequest('Configure and enable Chatwoot Base URL, Account ID, and API Token for this business first.')
  }

  const db = await getDb()
  const remoteContacts: any[] = Array.isArray(contactsRes?.payload) ? contactsRes.payload : []
  const remoteConvos: any[] = Array.isArray(convosRes?.data?.payload) ? convosRes.data.payload : []

  let syncedContacts = 0
  let syncedConversations = 0

  await db.transaction(async (tx) => {
    const extToLocalContact = new Map<string, string>()

    for (const c of remoteContacts) {
      const extId = String(c.id)
      const [existing] = await tx
        .select()
        .from(schema.chatwootContacts)
        .where(
          and(
            eq(schema.chatwootContacts.tenantId, ctx.tenantId),
            eq(schema.chatwootContacts.externalContactId, extId)
          )
        )

      if (existing) {
        await tx
          .update(schema.chatwootContacts)
          .set({
            name: c.name || existing.name,
            email: c.email ?? existing.email,
            phone: c.phone_number ?? existing.phone,
            avatarUrl: c.thumbnail ?? existing.avatarUrl,
            updatedAt: new Date()
          })
          .where(eq(schema.chatwootContacts.id, existing.id))
        extToLocalContact.set(extId, existing.id)
      } else {
        const [inserted] = await tx
          .insert(schema.chatwootContacts)
          .values({
            tenantId: ctx.tenantId,
            externalContactId: extId,
            name: c.name || `Contact ${extId}`,
            email: c.email ?? null,
            phone: c.phone_number ?? null,
            avatarUrl: c.thumbnail ?? null,
            lastActivityAt: c.last_activity_at ? new Date(c.last_activity_at * 1000) : new Date()
          })
          .returning()
        extToLocalContact.set(extId, inserted.id)
      }
      syncedContacts += 1
    }

    for (const conv of remoteConvos) {
      const extConvId = String(conv.id)
      const sender = conv.meta?.sender
      const extContactId = sender?.id ? String(sender.id) : null
      if (!extContactId) continue

      let localContactId = extToLocalContact.get(extContactId)
      if (!localContactId) {
        const [existing] = await tx
          .select()
          .from(schema.chatwootContacts)
          .where(
            and(
              eq(schema.chatwootContacts.tenantId, ctx.tenantId),
              eq(schema.chatwootContacts.externalContactId, extContactId)
            )
          )
        if (existing) {
          localContactId = existing.id
        } else {
          const [createdContact] = await tx
            .insert(schema.chatwootContacts)
            .values({
              tenantId: ctx.tenantId,
              externalContactId: extContactId,
              name: sender.name || `Contact ${extContactId}`,
              email: sender.email ?? null,
              phone: sender.phone_number ?? null
            })
            .returning()
          localContactId = createdContact.id
        }
      }

      const rawMsgs = Array.isArray(conv.messages) ? conv.messages : []
      const normalizedMessages = rawMsgs.map((m: any) => ({
        id: String(m.id),
        direction: m.message_type === 1 ? ('outgoing' as const) : ('incoming' as const),
        sender: m.sender?.name || (m.message_type === 1 ? 'Agent' : sender.name || 'Customer'),
        content: String(m.content || ''),
        sentAt: m.created_at ? new Date(m.created_at * 1000).toISOString() : new Date().toISOString()
      }))

      const lastMsg = normalizedMessages[normalizedMessages.length - 1]
      const [existingConv] = await tx
        .select()
        .from(schema.chatwootConversations)
        .where(
          and(
            eq(schema.chatwootConversations.tenantId, ctx.tenantId),
            eq(schema.chatwootConversations.externalConversationId, extConvId)
          )
        )

      if (existingConv) {
        await tx
          .update(schema.chatwootConversations)
          .set({
            status: conv.status || 'open',
            unreadCount: Number(conv.unread_count || 0),
            lastMessagePreview: lastMsg?.content?.slice(0, 200) || existingConv.lastMessagePreview,
            lastMessageAt: lastMsg ? new Date(lastMsg.sentAt) : existingConv.lastMessageAt,
            messages: normalizedMessages.length > 0 ? normalizedMessages : existingConv.messages,
            updatedAt: new Date()
          })
          .where(eq(schema.chatwootConversations.id, existingConv.id))
      } else {
        await tx.insert(schema.chatwootConversations).values({
          tenantId: ctx.tenantId,
          externalConversationId: extConvId,
          chatwootContactId: localContactId,
          inboxName: conv.meta?.channel || `Inbox #${conv.inbox_id || '1'}`,
          channel: conv.meta?.channel || 'web',
          status: conv.status || 'open',
          unreadCount: Number(conv.unread_count || 0),
          lastMessagePreview: lastMsg?.content?.slice(0, 200) || null,
          lastMessageAt: lastMsg ? new Date(lastMsg.sentAt) : new Date(),
          messages: normalizedMessages
        })
      }
      syncedConversations += 1
    }

    await tx
      .update(schema.integrationConfigs)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationConfigs.tenantId, ctx.tenantId),
          eq(schema.integrationConfigs.provider, 'chatwoot')
        )
      )

    await recordAudit(tx, ctx, {
      action: 'chatwoot.synced',
      entityType: 'integration_config',
      entityId: 'chatwoot',
      afterState: { syncedContacts, syncedConversations }
    })
  })

  return { syncedContacts, syncedConversations }
}

/**
 * Records an inbound/outbound Chatwoot webhook event into the tenant-isolated Chatwoot tables.
 */
export async function recordChatwootWebhookMessage(
  tenantId: string,
  payload: {
    externalContactId: string
    name: string
    email?: string | null
    phone?: string | null
    customerId?: string | null
    externalConversationId: string
    inboxName?: string
    direction: 'incoming' | 'outgoing'
    content: string
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    let [contact] = await tx
      .select()
      .from(schema.chatwootContacts)
      .where(
        and(
          eq(schema.chatwootContacts.tenantId, tenantId),
          eq(schema.chatwootContacts.externalContactId, payload.externalContactId)
        )
      )

    if (!contact) {
      ;[contact] = await tx
        .insert(schema.chatwootContacts)
        .values({
          tenantId,
          externalContactId: payload.externalContactId,
          customerId: payload.customerId ?? null,
          name: payload.name,
          email: payload.email ?? null,
          phone: payload.phone ?? null,
          lastActivityAt: new Date()
        })
        .returning()
    } else if (payload.customerId && !contact.customerId) {
      ;[contact] = await tx
        .update(schema.chatwootContacts)
        .set({ customerId: payload.customerId, lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.chatwootContacts.id, contact.id))
        .returning()
    }

    const msgEntry = {
      id: `msg_${Date.now()}`,
      direction: payload.direction,
      sender: payload.direction === 'incoming' ? payload.name : 'Team',
      content: payload.content,
      sentAt: new Date().toISOString()
    }

    const [existingConv] = await tx
      .select()
      .from(schema.chatwootConversations)
      .where(
        and(
          eq(schema.chatwootConversations.tenantId, tenantId),
          eq(schema.chatwootConversations.externalConversationId, payload.externalConversationId)
        )
      )

    if (existingConv) {
      const messages = [...existingConv.messages, msgEntry].slice(-100)
      await tx
        .update(schema.chatwootConversations)
        .set({
          lastMessagePreview: payload.content.slice(0, 200),
          lastMessageAt: new Date(),
          unreadCount: payload.direction === 'incoming' ? existingConv.unreadCount + 1 : 0,
          messages,
          updatedAt: new Date()
        })
        .where(eq(schema.chatwootConversations.id, existingConv.id))
    } else {
      await tx.insert(schema.chatwootConversations).values({
        tenantId,
        externalConversationId: payload.externalConversationId,
        chatwootContactId: contact.id,
        inboxName: payload.inboxName || 'Chatwoot Inbox',
        channel: 'chatwoot',
        status: 'open',
        unreadCount: payload.direction === 'incoming' ? 1 : 0,
        lastMessagePreview: payload.content.slice(0, 200),
        lastMessageAt: new Date(),
        messages: [msgEntry]
      })
    }
  })
}

export async function replyToChatwootConversation(
  ctx: ActorContext,
  conversationId: string,
  content: string
) {
  const db = await getDb()
  const [conv] = await db
    .select()
    .from(schema.chatwootConversations)
    .where(
      and(
        eq(schema.chatwootConversations.id, conversationId),
        eq(schema.chatwootConversations.tenantId, ctx.tenantId)
      )
    )
  if (!conv) throw Errors.notFound('Chatwoot conversation', conversationId)

  // Forward reply to live Chatwoot API if configured for this tenant
  let deliveredToChatwoot = false
  const remoteRes = await chatwootApiRequest(
    ctx.tenantId,
    `/conversations/${conv.externalConversationId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content, message_type: 'outgoing', private: false })
    }
  )
  if (remoteRes) deliveredToChatwoot = true

  const msgEntry = {
    id: `out_${Date.now()}`,
    direction: 'outgoing' as const,
    sender: ctx.actorLabel,
    content,
    sentAt: new Date().toISOString()
  }

  const updatedMessages = [...conv.messages, msgEntry].slice(-100)
  const [updated] = await db
    .update(schema.chatwootConversations)
    .set({
      messages: updatedMessages,
      lastMessagePreview: content.slice(0, 200),
      lastMessageAt: new Date(),
      unreadCount: 0,
      updatedAt: new Date()
    })
    .where(eq(schema.chatwootConversations.id, conv.id))
    .returning()

  return { conversation: updated, deliveredToChatwoot }
}

export async function linkChatwootContactToCustomer(ctx: ActorContext, chatwootContactId: string) {
  const db = await getDb()
  const [cwContact] = await db
    .select()
    .from(schema.chatwootContacts)
    .where(
      and(
        eq(schema.chatwootContacts.id, chatwootContactId),
        eq(schema.chatwootContacts.tenantId, ctx.tenantId)
      )
    )
  if (!cwContact) throw Errors.notFound('Chatwoot contact', chatwootContactId)

  if (cwContact.customerId) {
    return { chatwootContactId: cwContact.id, customerId: cwContact.customerId, created: false }
  }

  const customer = await createCustomer(ctx, {
    name: cwContact.name,
    email: cwContact.email ?? undefined,
    phone: cwContact.phone ?? undefined,
    leadSource: 'chatwoot',
    externalIds: { chatwootContactId: cwContact.externalContactId }
  })

  await db
    .update(schema.chatwootContacts)
    .set({ customerId: customer.id, updatedAt: new Date() })
    .where(eq(schema.chatwootContacts.id, cwContact.id))

  // Also ensure customer has externalId linked
  await updateCustomer(ctx, customer.id, {
    externalIds: { ...customer.externalIds, chatwootContactId: cwContact.externalContactId }
  })

  return { chatwootContactId: cwContact.id, customerId: customer.id, created: true }
}
