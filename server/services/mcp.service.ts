import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ActorContext } from '../utils/auth-context'
import { hasAllScopes, type Scope } from '../utils/scopes'
import { buildInsufficientScopeMessage } from '../utils/mcp-scopes'
import { formatCents } from '../utils/money'
import { Errors } from '../utils/errors'
import { sendQuoteEmailCopy, type EmailCopyStatus } from './document-email.service'
import {
  createCustomer,
  findCustomerCandidates,
  logInteraction
} from './customer.service'
import { createCatalogItem, listCatalogItems } from './catalog.service'
import {
  approveAndSendQuote,
  createDraftQuote,
  getQuoteById,
  listQuotes,
  updateDraftQuote
} from './quote.service'
import { listProductionQueue, updateWorkItem } from './production.service'
import { listInvoices } from './invoice.service'
import { recordPayment } from './payment.service'
import { approveExpense, createDraftExpense } from './expense.service'
import { approveStockMovement, createDraftStockAdjustment } from './inventory.service'
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
            '# Back Office Agent Guide',
            '',
            '1. **Never guess ambiguous customers**: Always call `find_customer` first. If `ambiguous: true`, read the candidates back to the owner and ask which one they mean.',
            '2. **Search catalog before creating items**: Call `search_catalog`. If an item is not found, call `create_catalog_item` (it will be flagged `verified: false` for operator review).',
            '3. **Draft then confirm**: Always draft quotes, expenses, and inventory adjustments first, read back the server-computed totals and document number, and only call `approve_*` with the exact `version` after the owner explicitly confirms.',
            '4. **Money is integer cents**: Provide `unitPriceCents` in integer cents (e.g. $12.50 = 1250). Never invent totals; the server computes all math.',
            '5. **Receipts required for expenses**: `create_draft_expense` requires a `receiptAttachmentId`.',
            '6. **Prompt safety**: Raw inbound customer messages are withheld from tool responses.'
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
    'Create a new catalog product or service. Agent-created items are automatically marked verified=false for operator review.',
    {
      name: z.string().min(1),
      type: z.enum(['product', 'service']).default('product'),
      sku: z.string().optional(),
      description: z.string().optional(),
      unit: z.string().default('each'),
      basePriceCents: z.number().int().min(0),
      attributes: z.record(z.unknown()).optional()
    },
    async (args) => {
      try {
        assertScope(ctx, ['catalog:write'])
        const item = await createCatalogItem(ctx, args)
        return okResult(
          `Created unverified catalog item "${item.name}" at ${formatCents(item.basePriceCents)}/${item.unit} (verified: ${item.verified}).`,
          item
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'create_draft_quote',
    'Create a numbered draft quote with server-computed line totals, tax, and grand total. Read back the Q-number and total before approving.',
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
        return okResult(
          `Drafted quote ${quote.quoteNumber} (v${quote.version}) for ${quote.customer.name}. Total: ${formatCents(quote.totalCents)}. PDF preview: ${baseUrl}${quote.pdfUrl}`,
          { ...quote, pdfFullUrl: `${baseUrl}${quote.pdfUrl}` }
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
        return okResult(
          `Updated draft quote ${updated.quoteNumber} to v${updated.version}. New total: ${formatCents(updated.totalCents)}.`,
          updated
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'get_quote',
    'Fetch quote details, line items, version, server-computed totals, and branded PDF link.',
    { quoteId: z.string().uuid() },
    async ({ quoteId }) => {
      try {
        assertScope(ctx, ['quotes:read'])
        const quote = await getQuoteById(ctx, quoteId)
        return okResult(
          `Quote ${quote.quoteNumber} (${quote.status}, v${quote.version}) for ${quote.customer.name}: ${formatCents(quote.totalCents)}. PDF: ${baseUrl}${quote.pdfUrl}`,
          { ...quote, pdfFullUrl: `${baseUrl}${quote.pdfUrl}` }
        )
      } catch (err) {
        return errResult(err)
      }
    }
  )

  server.tool(
    'approve_quote',
    'Approve and finalize a draft quote (generates branded PDF). Requires exact draft version. Blocked if tenant has not opted into agent approvals. On success, emails a PDF copy to the signed-in user only.',
    {
      quoteId: z.string().uuid(),
      version: z.number().int().min(1)
    },
    async ({ quoteId, version }) => {
      try {
        assertScope(ctx, ['quotes:approve'])
        const approved = await approveAndSendQuote(ctx, quoteId, version)
        const emailSentence = formatEmailCopySentence(approved.quoteNumber, approved.emailCopy)
        return okResult(
          `Approved quote ${approved.quoteNumber} (status: ${approved.status}, v${approved.version}). ${emailSentence} PDF ready at ${baseUrl}${approved.pdfUrl}`,
          { ...approved, pdfFullUrl: `${baseUrl}${approved.pdfUrl}` }
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
