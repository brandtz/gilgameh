import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActorContext } from '../utils/auth-context'
import { hasAllScopes, type Scope } from '../utils/scopes'
import { buildInsufficientScopeMessage } from '../utils/mcp-scopes'
import { buildShareablePdfUrl } from '../utils/pdf-share-token'
import { formatCents } from '../utils/money'
import { Errors } from '../utils/errors'
import { sendQuoteEmailCopy, type EmailCopyStatus } from './document-email.service'
import { storeAttachment } from './attachment.service'
import {
  createCustomer,
  findCustomerCandidates,
  listCustomers,
  listInteractions,
  logInteraction,
  updateCustomer
} from './customer.service'
import {
  createCatalogItem,
  listCatalogItems,
  updateCatalogItem
} from './catalog.service'
import {
  approveAndSendQuote,
  createDraftQuote,
  createQuoteRevision,
  getQuoteById,
  listQuotes,
  updateDraftQuote
} from './quote.service'
import {
  createOrderFromQuote,
  listOrders,
  updateOrderStatus
} from './order.service'
import { listProductionQueue, updateWorkItem } from './production.service'
import {
  approveAndSendInvoice,
  createDraftInvoice,
  createInvoiceFromOrder,
  createInvoiceFromQuote,
  getInvoiceById,
  listInvoices
} from './invoice.service'
import { recordPayment } from './payment.service'
import { approveExpense, createDraftExpense } from './expense.service'
import {
  approveStockMovement,
  createDraftStockAdjustment,
  listInventory
} from './inventory.service'
import { getBusinessSummary } from './integration.service'

// Strict schema with additionalProperties: false — rejects any `to`, `cc`, `bcc` or unknown field.
export const emailQuoteCopyInputSchema = z
  .object({
    quoteId: z.string().uuid()
  })
  .strict()

function assertScope(ctx: ActorContext, required: Scope[]) {
  if (!hasAllScopes(ctx.scopes, required)) {
    const granted = new Set(ctx.scopes)
    const missing = required.filter((s) => !granted.has(s))
    throw Errors.forbidden(buildInsufficientScopeMessage(missing), {
      requiredScopes: missing
    })
  }
}

function formatEmailCopySentence(quoteNumber: string, emailCopy: EmailCopyStatus): string {
  if (emailCopy.status === 'sent') {
    return `Emailed ${quoteNumber} (PDF attached) to ${emailCopy.sentTo} from ${emailCopy.from}.`
  }
  if (emailCopy.status === 'skipped') {
    return `Email copy skipped: ${emailCopy.reason || 'not configured'}`
  }
  return `Email copy failed: ${emailCopy.reason || 'delivery error'}`
}

function okResult(summary: string, data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ summary, data }, null, 2)
      }
    ]
  }
}

function errResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const details = (err as { details?: unknown })?.details
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, ...(details ? { details } : {}) }, null, 2)
      }
    ]
  }
}

/**
 * Creates a request-scoped MCP server bound to the authenticated ActorContext.
 * Thin adapter over the domain service layer — zero duplicated business logic.
 */
export function createMcpServerForActor(ctx: ActorContext): McpServer {
  const server = new McpServer({
    name: 'back-office-platform',
    version: '1.0.0'
  })

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'

  // Resource: getting-started usage guide for AI agents
  server.resource(
    'getting-started',
    'backoffice://getting-started',
    { description: 'Operating rules and workflow guide for Back Office AI agents', mimeType: 'text/markdown' },
    async () => ({
      contents: [
        {
          uri: 'backoffice://getting-started',
          mimeType: 'text/markdown',
          text: [
            '# Back Office Voice Agent Guide',
            '',
            'You are the voice/chat translation layer between the business owner and their Back Office platform.',
            '',
            '1. **Validate before executing mutations**: Always read back names, quantities, prices, and descriptions and get the owner\'s verbal confirmation before creating/updating quotes, invoices, orders, catalog items, or inventory adjustments.',
            '2. **Never guess ambiguous customers**: Always call `find_customer` first. If `ambiguous: true`, read candidates back and ask which one.',
            '3. **Direct shareable PDF links**: `create_draft_quote`, `get_quote`, `approve_quote`, `create_draft_invoice`, `get_invoice`, and `approve_invoice` all return a signed `shareablePdfUrl`. Always give the owner that direct link so they can view, download, or text/share the PDF straight from their phone without logging into Back Office.',
            '4. **Photos of products/wood slabs or receipts**: When the owner shares an image (e.g. a wood slab photo with name, description, price, and stock level, or an expense receipt), call `upload_attachment` first, then pass the returned `attachmentId` into `create_catalog_item` / `update_catalog_item` (via `attributes.photoAttachmentId`) or `create_draft_expense` (`receiptAttachmentId`).',
            '5. **Draft then confirm**: Always draft quotes, invoices, expenses, and inventory adjustments first, read back the document number and server-computed total, and call `approve_*` with the exact `version` only after explicit confirmation.',
            '6. **Money is integer cents**: Provide prices in integer cents (e.g. $40.00 = 4000). Never invent totals; the server computes all math.',
            '7. **Prompt safety**: Raw inbound customer messages are withheld from tool responses.'
          ].join('\n')
        }
      ]
    })
  )

  // ── Phase 1 Tools ───────────────────────────────────────────────────────────

  server.tool(
    'find_customer',
    'Search customers by name, company, email, or phone. Returns candidates and flags ambiguity if multiple match; never guesses.',
    { query: z.string().min(1) },
    async ({ query }) => {
      try {
        assertScope(ctx, ['customers:read'])
        const res = await findCustomerCandidates(ctx, query)
        const summary =
          res.count === 0
            ? `No customers matched "${query}". You may create a new customer with create_customer.`
            : res.ambiguous
              ? `Found ${res.count} matching customers for "${query}". Ask the owner to clarify before proceeding.`
              : `Matched 1 customer: ${res.exactMatch!.name} (${res.exactMatch!.id}).`
        return okResult(summary, res)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_customer',
    'Create a new customer or lead record.',
    {
      name: z.string().min(1),
      type: z.enum(['person', 'organization']).default('person'),
      companyName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      leadSource: z.string().optional(),
      notes: z.string().optional()
    },
    async (args) => {
      try {
        assertScope(ctx, ['customers:write'])
        const customer = await createCustomer(ctx, args)
        return okResult(`Created customer "${customer.name}" (ID: ${customer.id}).`, customer)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'log_interaction',
    'Log a summarized touchpoint (call, walk-in, message, form) against a customer.',
    {
      customerId: z.string().uuid(),
      channel: z.enum(['call', 'walk_in', 'message', 'form', 'email', 'other']).default('call'),
      direction: z.enum(['inbound', 'outbound', 'internal']).default('inbound'),
      summary: z.string().min(1)
    },
    async (args) => {
      try {
        assertScope(ctx, ['customers:write'])
        const interaction = await logInteraction(ctx, args)
        return okResult(`Logged ${args.channel} interaction for customer ${args.customerId}.`, interaction)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'update_customer',
    'Update an existing customer record (name, company, email, phone, status, notes, or waitingOnOwner flag). Confirm changes with the owner first.',
    {
      customerId: z.string().uuid(),
      version: z.number().int().min(1).optional(),
      name: z.string().min(1).optional(),
      companyName: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      status: z.enum(['lead', 'active', 'inactive']).optional(),
      waitingOnOwner: z.boolean().optional(),
      notes: z.string().nullable().optional()
    },
    async ({ customerId, ...patch }) => {
      try {
        assertScope(ctx, ['customers:write'])
        const updated = await updateCustomer(ctx, customerId, patch)
        return okResult(`Updated customer "${updated.name}" (v${updated.version}).`, updated)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_customers_waiting',
    'List all customers currently flagged as waiting on the owner for a follow-up.',
    { limit: z.number().int().min(1).max(50).default(25) },
    async ({ limit }) => {
      try {
        assertScope(ctx, ['customers:read'])
        const res = await listCustomers(ctx, { waitingOnOwner: true, limit, offset: 0 })
        return okResult(
          res.total === 0
            ? 'No customers are currently waiting on you.'
            : `${res.total} customer(s) are waiting on you: ${res.items.map((c) => c.name).join(', ')}.`,
          res.items
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_interactions',
    'Read summarized touchpoint history for a customer (raw inbound customer messages are withheld for prompt safety).',
    {
      customerId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(20)
    },
    async ({ customerId, limit }) => {
      try {
        assertScope(ctx, ['customers:read'])
        const res = await listInteractions(ctx, {
          customerId,
          limit,
          offset: 0,
          redactExternalRaw: true
        })
        return okResult(`Found ${res.total} logged interaction(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'upload_attachment',
    'Upload a base64-encoded image or file (e.g. a wood slab photo, product photo, or expense receipt) and return an attachmentId to attach to catalog items, expenses, quotes, or orders.',
    {
      entityType: z.enum(['quote', 'invoice', 'expense', 'customer', 'order', 'general']).default('general'),
      entityId: z.string().uuid().optional(),
      filename: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(120),
      contentBase64: z.string().min(1)
    },
    async (args) => {
      try {
        assertScope(ctx, ['catalog:write'])
        const data = Buffer.from(args.contentBase64, 'base64')
        const saved = await storeAttachment(ctx, {
          entityType: args.entityType,
          entityId: args.entityId ?? null,
          filename: args.filename,
          mimeType: args.mimeType,
          data
        })
        return okResult(
          `Uploaded "${saved.filename}" (${saved.sizeBytes} bytes). Attachment ID: ${saved.id}.`,
          saved
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'search_catalog',
    'Search tenant catalog products and services by name, SKU, or description.',
    {
      query: z.string().optional(),
      type: z.enum(['product', 'service']).optional()
    },
    async ({ query, type }) => {
      try {
        assertScope(ctx, ['catalog:read'])
        const res = await listCatalogItems(ctx, { q: query, type, limit: 20, offset: 0 })
        return okResult(`Found ${res.total} catalog item(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_catalog_item',
    'Create a new catalog product or service with optional inventory tracking, initial stock quantity, custom attributes (dimensions, species, finish), and photo attachmentId. Agent-created items are marked verified=false for operator review.',
    {
      name: z.string().min(1),
      type: z.enum(['product', 'service']).default('product'),
      sku: z.string().optional(),
      description: z.string().optional(),
      unit: z.string().default('each'),
      basePriceCents: z.number().int().min(0),
      taxable: z.boolean().optional(),
      trackInventory: z.boolean().optional(),
      initialQuantityOnHand: z.number().int().min(0).optional(),
      reorderPoint: z.number().int().min(0).optional(),
      photoAttachmentId: z.string().uuid().optional(),
      attributes: z.record(z.unknown()).optional()
    },
    async ({ photoAttachmentId, attributes, ...rest }) => {
      try {
        assertScope(ctx, ['catalog:write'])
        const mergedAttrs = {
          ...(attributes || {}),
          ...(photoAttachmentId ? { photoAttachmentId } : {})
        }
        const item = await createCatalogItem(ctx, {
          ...rest,
          trackInventory: rest.trackInventory ?? (rest.initialQuantityOnHand !== undefined),
          attributes: mergedAttrs
        })
        return okResult(
          `Created catalog item "${item.name}" at ${formatCents(item.basePriceCents)}/${item.unit}${rest.initialQuantityOnHand !== undefined ? ` (initial stock: ${rest.initialQuantityOnHand})` : ''}${photoAttachmentId ? ' with photo attached' : ''} (verified: ${item.verified}).`,
          item
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'update_catalog_item',
    'Update an existing catalog product or service (name, description, price, unit, SKU, custom attributes, photo attachmentId, or active flag). Confirm changes with the owner first.',
    {
      catalogItemId: z.string().uuid(),
      version: z.number().int().min(1).optional(),
      name: z.string().min(1).optional(),
      sku: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      unit: z.string().min(1).optional(),
      basePriceCents: z.number().int().min(0).optional(),
      taxable: z.boolean().optional(),
      trackInventory: z.boolean().optional(),
      isActive: z.boolean().optional(),
      photoAttachmentId: z.string().uuid().optional(),
      attributes: z.record(z.unknown()).optional()
    },
    async ({ catalogItemId, photoAttachmentId, attributes, ...rest }) => {
      try {
        assertScope(ctx, ['catalog:write'])
        const mergedAttrs =
          attributes || photoAttachmentId
            ? {
                ...(attributes || {}),
                ...(photoAttachmentId ? { photoAttachmentId } : {})
              }
            : undefined
        const updated = await updateCatalogItem(ctx, catalogItemId, {
          ...rest,
          ...(mergedAttrs ? { attributes: mergedAttrs } : {})
        })
        return okResult(
          `Updated catalog item "${updated.name}" to ${formatCents(updated.basePriceCents)}/${updated.unit} (v${updated.version}).`,
          updated
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_draft_quote',
    'Create a numbered draft quote with server-computed line totals, tax, and grand total. Returns a direct shareablePdfUrl the owner can open/share without logging in. Read back the Q-number and total before approving.',
    {
      customerId: z.string().uuid(),
      customerPoNumber: z.string().optional(),
      notes: z.string().optional(),
      lines: z
        .array(
          z.object({
            catalogItemId: z.string().uuid().optional(),
            description: z.string().min(1),
            quantity: z.number().positive(),
            unit: z.string().default('each'),
            unitPriceCents: z.number().int().min(0),
            taxable: z.boolean().optional(),
            attributes: z.record(z.unknown()).optional()
          })
        )
        .min(1)
    },
    async (args) => {
      try {
        assertScope(ctx, ['quotes:draft'])
        const quote = await createDraftQuote(ctx, args)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'quote',
          docId: quote.id
        })
        return okResult(
          `Drafted quote ${quote.quoteNumber} (v${quote.version}) for ${quote.customer.name}. Total: ${formatCents(quote.totalCents)}. Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...quote, pdfFullUrl: `${baseUrl}${quote.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'update_draft_quote',
    'Update an existing draft quote. Requires the exact current version for optimistic concurrency.',
    {
      quoteId: z.string().uuid(),
      version: z.number().int().min(1),
      customerPoNumber: z.string().optional(),
      notes: z.string().optional(),
      lines: z
        .array(
          z.object({
            catalogItemId: z.string().uuid().optional(),
            description: z.string().min(1),
            quantity: z.number().positive(),
            unit: z.string().default('each'),
            unitPriceCents: z.number().int().min(0),
            taxable: z.boolean().optional(),
            attributes: z.record(z.unknown()).optional()
          })
        )
        .min(1)
        .optional()
    },
    async ({ quoteId, ...patch }) => {
      try {
        assertScope(ctx, ['quotes:draft'])
        const updated = await updateDraftQuote(ctx, quoteId, patch)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'quote',
          docId: updated.id
        })
        return okResult(
          `Updated draft quote ${updated.quoteNumber} to v${updated.version}. New total: ${formatCents(updated.totalCents)}. Direct PDF: ${shareablePdfUrl}`,
          { ...updated, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'get_quote',
    'Fetch quote details, line items, version, server-computed totals, and a direct shareablePdfUrl that works on mobile or in chat without logging in.',
    { quoteId: z.string().uuid() },
    async ({ quoteId }) => {
      try {
        assertScope(ctx, ['quotes:read'])
        const quote = await getQuoteById(ctx, quoteId)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'quote',
          docId: quote.id
        })
        return okResult(
          `Quote ${quote.quoteNumber} (${quote.status}, v${quote.version}) for ${quote.customer.name}: ${formatCents(quote.totalCents)}. Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...quote, pdfFullUrl: `${baseUrl}${quote.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'revise_quote',
    'Create the next editable draft revision (e.g. Q-1001-R2) from an existing sent or draft quote.',
    { quoteId: z.string().uuid() },
    async ({ quoteId }) => {
      try {
        assertScope(ctx, ['quotes:draft'])
        const revised = await createQuoteRevision(ctx, quoteId)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'quote',
          docId: revised.id
        })
        return okResult(
          `Created revision ${revised.quoteNumber} (v${revised.version}, draft) for ${revised.customer.name}. Total: ${formatCents(revised.totalCents)}. Direct PDF: ${shareablePdfUrl}`,
          { ...revised, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'approve_quote',
    'Approve and finalize a draft quote (generates branded PDF). Requires exact draft version. Blocked if tenant has not opted into agent approvals. On success, emails a PDF copy to the signed-in user only and returns a direct shareablePdfUrl.',
    {
      quoteId: z.string().uuid(),
      version: z.number().int().min(1)
    },
    async ({ quoteId, version }) => {
      try {
        assertScope(ctx, ['quotes:approve'])
        const approved = await approveAndSendQuote(ctx, quoteId, version)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'quote',
          docId: approved.id
        })
        const emailSentence = formatEmailCopySentence(approved.quoteNumber, approved.emailCopy)
        return okResult(
          `Approved quote ${approved.quoteNumber} (status: ${approved.status}, v${approved.version}). ${emailSentence} Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...approved, pdfFullUrl: `${baseUrl}${approved.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  // NOTE: `email_quote_copy` only requires `quotes:read` because the recipient is strictly locked
  // server-side to the authenticated user's own email. Any future `send_quote_to_customer` tool
  // MUST introduce a new `quotes:send` scope, explicit confirmation design, and customer interaction logging.
  server.tool(
    'email_quote_copy',
    'Email a copy of a finalized quote (PDF attached) to the signed-in user only. Cannot send to customers or any other address.',
    {
      quoteId: z.string().uuid()
    },
    async (rawArgs) => {
      try {
        assertScope(ctx, ['quotes:read'])
        const { quoteId } = emailQuoteCopyInputSchema.parse(rawArgs)
        const quote = await getQuoteById(ctx, quoteId)
        const emailCopy = await sendQuoteEmailCopy(ctx, quoteId, 'manual')
        const sentence = formatEmailCopySentence(quote.quoteNumber, emailCopy)
        return okResult(sentence, { quoteId: quote.id, quoteNumber: quote.quoteNumber, emailCopy })
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_open_quotes',
    'List open quotes (draft and sent) for the active tenant.',
    { limit: z.number().int().min(1).max(50).default(20) },
    async ({ limit }) => {
      try {
        assertScope(ctx, ['quotes:read'])
        const res = await listQuotes(ctx, { openOnly: true, limit, offset: 0 })
        return okResult(`Found ${res.total} open quote(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  // ── Full-Platform Operational Tools ─────────────────────────────────────────

  server.tool(
    'create_order_from_quote',
    'Convert a sent or accepted quote into an Order (automatically queues production WorkItems and deducts tracked inventory).',
    { quoteId: z.string().uuid() },
    async ({ quoteId }) => {
      try {
        assertScope(ctx, ['orders:write'])
        const order = await createOrderFromQuote(ctx, quoteId)
        return okResult(
          `Created order ${order.orderNumber} for ${order.customer.name} (${formatCents(order.totalCents)}) with ${order.workItems.length} production item(s) queued.`,
          order
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_orders',
    'List recent or filtered orders for the active business.',
    {
      status: z.enum(['pending', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(50).default(20)
    },
    async ({ status, limit }) => {
      try {
        assertScope(ctx, ['orders:read'])
        const res = await listOrders(ctx, { status, limit, offset: 0 })
        return okResult(`Found ${res.total} order(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'update_order_status',
    'Update an order status (requires current version). Fires outbound website status webhooks.',
    {
      orderId: z.string().uuid(),
      version: z.number().int().min(1),
      status: z.enum(['pending', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled']),
      notes: z.string().optional()
    },
    async ({ orderId, ...patch }) => {
      try {
        assertScope(ctx, ['orders:write'])
        const updated = await updateOrderStatus(ctx, orderId, patch)
        return okResult(`Order ${updated.orderNumber} marked "${updated.status}" (v${updated.version}).`, updated)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_production_queue',
    'List active production work items sorted by priority rank and due date.',
    {
      state: z.enum(['queued', 'in_progress', 'ready', 'shipped', 'picked_up']).optional(),
      limit: z.number().int().min(1).max(50).default(25)
    },
    async ({ state, limit }) => {
      try {
        assertScope(ctx, ['production:read'])
        const res = await listProductionQueue(ctx, { state, activeOnly: !state, limit, offset: 0 })
        return okResult(`Found ${res.total} production work item(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'update_work_item',
    'Update a production work item state, priority rank, or notes (requires current version).',
    {
      workItemId: z.string().uuid(),
      version: z.number().int().min(1),
      state: z.enum(['queued', 'in_progress', 'ready', 'shipped', 'picked_up', 'cancelled']).optional(),
      priorityRank: z.number().int().min(1).max(10000).optional(),
      notes: z.string().optional()
    },
    async ({ workItemId, ...patch }) => {
      try {
        assertScope(ctx, ['production:write'])
        const updated = await updateWorkItem(ctx, workItemId, patch)
        return okResult(`Updated work item "${updated.title}" to state "${updated.state}" (v${updated.version}).`, updated)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_draft_invoice',
    'Create a numbered draft invoice either from an existing quoteId, from an orderId, or standalone with customerId + lines. Returns a direct shareablePdfUrl.',
    {
      fromQuoteId: z.string().uuid().optional(),
      fromOrderId: z.string().uuid().optional(),
      customerId: z.string().uuid().optional(),
      notes: z.string().optional(),
      lines: z
        .array(
          z.object({
            catalogItemId: z.string().uuid().optional(),
            description: z.string().min(1),
            quantity: z.number().positive(),
            unit: z.string().default('each'),
            unitPriceCents: z.number().int().min(0),
            taxable: z.boolean().optional()
          })
        )
        .min(1)
        .optional()
    },
    async (args) => {
      try {
        assertScope(ctx, ['invoices:draft'])
        let inv
        if (args.fromQuoteId) {
          inv = await createInvoiceFromQuote(ctx, args.fromQuoteId)
        } else if (args.fromOrderId) {
          inv = await createInvoiceFromOrder(ctx, args.fromOrderId)
        } else {
          if (!args.customerId || !args.lines || args.lines.length === 0) {
            throw Errors.badRequest('Provide fromQuoteId, fromOrderId, or customerId with lines')
          }
          inv = await createDraftInvoice(ctx, {
            customerId: args.customerId,
            notes: args.notes,
            lines: args.lines
          })
        }
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'invoice',
          docId: inv.id
        })
        return okResult(
          `Drafted invoice ${inv.invoiceNumber} (v${inv.version}) for ${inv.customer.name}. Total: ${formatCents(inv.totalCents)}. Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...inv, pdfFullUrl: `${baseUrl}${inv.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'get_invoice',
    'Fetch invoice details, lines, payments, balance due, and a direct shareablePdfUrl downloadable without login.',
    { invoiceId: z.string().uuid() },
    async ({ invoiceId }) => {
      try {
        assertScope(ctx, ['invoices:read'])
        const inv = await getInvoiceById(ctx, invoiceId)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'invoice',
          docId: inv.id
        })
        return okResult(
          `Invoice ${inv.invoiceNumber} (${inv.status}, v${inv.version}) for ${inv.customer.name}: Total ${formatCents(inv.totalCents)}, Balance Due ${formatCents(inv.balanceDueCents)}. Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...inv, pdfFullUrl: `${baseUrl}${inv.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'approve_invoice',
    'Approve and finalize a draft invoice (generates branded PDF). Requires exact draft version and tenant agent-approval opt-in. Returns direct shareablePdfUrl.',
    {
      invoiceId: z.string().uuid(),
      version: z.number().int().min(1)
    },
    async ({ invoiceId, version }) => {
      try {
        assertScope(ctx, ['invoices:approve'])
        const approved = await approveAndSendInvoice(ctx, invoiceId, version)
        const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
          tenantId: ctx.tenantId,
          docType: 'invoice',
          docId: approved.id
        })
        return okResult(
          `Approved invoice ${approved.invoiceNumber} (status: ${approved.status}, v${approved.version}). Balance due: ${formatCents(approved.balanceDueCents)}. Direct PDF (no login required): ${shareablePdfUrl}`,
          { ...approved, pdfFullUrl: `${baseUrl}${approved.pdfUrl}`, shareablePdfUrl }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_unpaid_invoices',
    'List sent, partially paid, or overdue invoices with remaining balances.',
    { limit: z.number().int().min(1).max(50).default(25) },
    async ({ limit }) => {
      try {
        assertScope(ctx, ['invoices:read'])
        const res = await listInvoices(ctx, { unpaidOnly: true, limit, offset: 0 })
        return okResult(`Found ${res.total} unpaid invoice(s).`, res.items)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'list_inventory',
    'List tracked inventory stock levels and optionally filter to low-stock items only.',
    { lowStockOnly: z.boolean().default(false) },
    async ({ lowStockOnly }) => {
      try {
        assertScope(ctx, ['inventory:read'])
        const all = await listInventory(ctx)
        const items = lowStockOnly ? all.filter((i) => i.lowStock) : all
        return okResult(
          `Found ${items.length} ${lowStockOnly ? 'low-stock ' : ''}inventory item(s).`,
          items
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'record_payment',
    'Record a payment against an open invoice.',
    {
      invoiceId: z.string().uuid(),
      method: z.enum(['check', 'cash', 'card', 'stripe', 'ach', 'other']),
      amountCents: z.number().int().positive(),
      reference: z.string().optional(),
      notes: z.string().optional()
    },
    async (args) => {
      try {
        assertScope(ctx, ['invoices:draft'])
        const res = await recordPayment(ctx, args)
        return okResult(
          `Recorded ${formatCents(args.amountCents)} (${args.method}) against ${res.invoice.invoiceNumber}. Remaining balance: ${formatCents(res.invoice.balanceDueCents)}.`,
          res
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_draft_expense',
    'Create a draft expense. Requires receiptAttachmentId when called by an AI agent.',
    {
      vendor: z.string().min(1),
      expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      category: z.string().default('supplies'),
      taxCents: z.number().int().min(0).default(0),
      receiptAttachmentId: z.string().uuid().optional(),
      notes: z.string().optional(),
      lineItems: z
        .array(
          z.object({
            description: z.string().min(1),
            quantity: z.number().positive().default(1),
            unitPriceCents: z.number().int().min(0)
          })
        )
        .min(1)
    },
    async (args) => {
      try {
        assertScope(ctx, ['expenses:draft'])
        const exp = await createDraftExpense(ctx, args)
        return okResult(
          `Drafted expense for ${exp.vendor} (${exp.expenseDate}) totaling ${formatCents(exp.totalCents)} (v${exp.version}).`,
          exp
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'approve_expense',
    'Approve a drafted expense (requires exact draft version).',
    {
      expenseId: z.string().uuid(),
      version: z.number().int().min(1)
    },
    async ({ expenseId, version }) => {
      try {
        assertScope(ctx, ['expenses:approve'])
        const exp = await approveExpense(ctx, expenseId, version)
        return okResult(`Approved expense for ${exp.vendor} (${formatCents(exp.totalCents)}).`, exp)
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'adjust_inventory',
    'Draft a stock movement adjustment (or approve an existing drafted movement if movementId + version are provided).',
    {
      catalogItemId: z.string().uuid().optional(),
      movementType: z.enum(['receipt', 'sale', 'adjustment', 'production_use']).default('adjustment'),
      quantityDelta: z.number().int().optional(),
      reason: z.string().optional(),
      approveMovementId: z.string().uuid().optional(),
      version: z.number().int().min(1).optional()
    },
    async (args) => {
      try {
        assertScope(ctx, ['inventory:adjust'])
        if (args.approveMovementId && args.version) {
          const res = await approveStockMovement(ctx, args.approveMovementId, args.version)
          return okResult(
            `Approved stock adjustment. New quantity on hand: ${res.inventory.quantityOnHand}.`,
            res
          )
        }
        if (!args.catalogItemId || !args.quantityDelta || !args.reason) {
          throw Errors.badRequest('catalogItemId, non-zero quantityDelta, and reason are required to draft an adjustment')
        }
        const movement = await createDraftStockAdjustment(ctx, {
          catalogItemId: args.catalogItemId,
          movementType: args.movementType,
          quantityDelta: args.quantityDelta,
          reason: args.reason
        })
        return okResult(
          `Drafted inventory adjustment (${args.quantityDelta > 0 ? '+' : ''}${args.quantityDelta}, v${movement.version}). Confirm to apply.`,
          movement
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'business_summary',
    'Get a high-level operational snapshot: open quotes, active orders, production queue, unpaid invoices, low stock, and customers waiting on owner.',
    {},
    async () => {
      try {
        const summary = await getBusinessSummary(ctx)
        return okResult(
          `Open quotes: ${summary.openQuotesCount} (${formatCents(summary.openQuotesTotalCents)}), Active orders: ${summary.activeOrdersCount}, Unpaid invoices: ${summary.unpaidInvoicesCount} (${formatCents(summary.unpaidInvoicesBalanceCents)}), Customers waiting on owner: ${summary.customersWaitingOnOwner}.`,
          summary
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  return server
}
