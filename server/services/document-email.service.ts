import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import { formatCents } from '../utils/money'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { sendEmail } from './email.service'
import { getAttachmentWithBytes } from './attachment.service'
import { generateBrandedDocumentPdf } from './pdf.service'
import { buildShareablePdfUrl } from '../utils/pdf-share-token'

/**
 * Returns true if an email address uses a non-routable local/test TLD
 * (such as `.local`, `.localhost`, `.internal`, `.example`) that causes
 * Microsoft 365 / Gmail spam filters to quarantine or drop the email.
 */
export function isNonRoutableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.trim().toLowerCase() || ''
  if (!domain || !domain.includes('.')) return true
  return /\.(local|localhost|internal|example|invalid|test)$/.test(domain)
}

export interface EmailCopyStatus {
  status: 'sent' | 'failed' | 'skipped'
  sentTo?: string
  from?: string
  messageId?: string
  reason?: string
}

export interface DocumentEmailRenderInput {
  docType: 'Quote' | 'Invoice'
  docNumber: string
  issuedDate: string
  customerName: string
  customerPoNumber?: string | null
  tenantName: string
  logoUrl?: string | null
  primaryColor?: string
  accentColor?: string
  paymentInstructions?: string | null
  notes?: string | null
  appUrl: string
  shareablePdfUrl?: string | null
  currency: string
  taxLabel: string
  lines: Array<{
    description: string
    quantity: string | number
    unit: string
    unitPriceCents: number
    lineTotalCents: number
  }>
  subtotalCents: number
  taxCents: number
  totalCents: number
}

/**
 * Escapes all HTML special characters to prevent XSS / injection in email HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Strips CR and LF to close SMTP/HTTP email header injection vectors.
 */
export function sanitizeHeaderValue(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').trim()
}

export function slugifyFilenamePart(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'customer'
}

/**
 * Reusable mobile-friendly HTML + plain-text renderer for Quotes (and Invoices later).
 * Every monetary figure comes from integer cents and is formatted strictly at render time.
 */
export function renderDocumentCopyEmail(input: DocumentEmailRenderInput): {
  subject: string
  html: string
  text: string
} {
  const totalFormatted = formatCents(input.totalCents, input.currency)
  const subtotalFormatted = formatCents(input.subtotalCents, input.currency)
  const taxFormatted = formatCents(input.taxCents, input.currency)

  const subject = sanitizeHeaderValue(
    `${input.docType} ${input.docNumber} — ${input.customerName} — ${totalFormatted}`
  )

  const primaryColor = /^#[0-9a-fA-F]{6}$/.test(input.primaryColor || '')
    ? input.primaryColor!
    : '#1e293b'
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(input.accentColor || '')
    ? input.accentColor!
    : '#b45309'

  const safeLogoUrl =
    input.logoUrl && /^https?:\/\//i.test(input.logoUrl) ? escapeHtml(input.logoUrl) : null

  const lineRowsHtml = input.lines
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;">
            ${escapeHtml(line.description)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:right;white-space:nowrap;">
            ${escapeHtml(String(Number(line.quantity)))} ${escapeHtml(line.unit)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:right;white-space:nowrap;">
            ${escapeHtml(formatCents(line.unitPriceCents, input.currency))}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;white-space:nowrap;">
            ${escapeHtml(formatCents(line.lineTotalCents, input.currency))}
          </td>
        </tr>`
    )
    .join('')

  const notesHtml = input.notes
    ? `<div style="margin-top:16px;padding:12px 14px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
         <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Notes / Special Instructions</div>
         <div style="font-size:13px;line-height:1.5;color:#1e293b;">${escapeHtml(input.notes)}</div>
       </div>`
    : ''

  const paymentHtml = input.paymentInstructions
    ? `<div style="margin-top:12px;padding:12px 14px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
         <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${accentColor};margin-bottom:4px;">Payment Instructions</div>
         <div style="font-size:13px;line-height:1.5;color:#1e293b;font-weight:600;">${escapeHtml(input.paymentInstructions)}</div>
       </div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:20px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background-color:${primaryColor};padding:22px 24px;border-bottom:4px solid ${accentColor};">
              ${safeLogoUrl ? `<img src="${safeLogoUrl}" alt="${escapeHtml(input.tenantName)}" style="max-height:44px;max-width:160px;display:block;margin-bottom:10px;background:#ffffff;padding:4px;border-radius:4px;" />` : ''}
              <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#fcd34d;">${escapeHtml(input.docType)} Copy</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">${escapeHtml(input.tenantName)} — ${escapeHtml(input.docNumber)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td style="font-size:13px;color:#475569;padding-bottom:6px;">
                    <strong style="color:#0f172a;">Customer:</strong> ${escapeHtml(input.customerName)}
                  </td>
                  <td style="font-size:13px;color:#475569;text-align:right;padding-bottom:6px;">
                    <strong style="color:#0f172a;">Date:</strong> ${escapeHtml(input.issuedDate)}
                  </td>
                </tr>
                ${
                  input.customerPoNumber
                    ? `<tr><td colspan="2" style="font-size:13px;color:#475569;"><strong style="color:#0f172a;">Customer PO:</strong> ${escapeHtml(input.customerPoNumber)}</td></tr>`
                    : ''
                }
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <thead>
                  <tr style="background-color:#f8fafc;">
                    <th align="left" style="padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;">Item</th>
                    <th align="right" style="padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;">Qty</th>
                    <th align="right" style="padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;">Price</th>
                    <th align="right" style="padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${lineRowsHtml}
                </tbody>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="font-size:13px;color:#64748b;text-align:right;padding:4px 8px;">Subtotal</td>
                  <td style="font-size:13px;color:#0f172a;text-align:right;padding:4px 8px;width:120px;">${escapeHtml(subtotalFormatted)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#64748b;text-align:right;padding:4px 8px;">${escapeHtml(input.taxLabel)}</td>
                  <td style="font-size:13px;color:#0f172a;text-align:right;padding:4px 8px;width:120px;">${escapeHtml(taxFormatted)}</td>
                </tr>
                <tr>
                  <td style="font-size:15px;font-weight:700;color:#0f172a;text-align:right;padding:8px;border-top:2px solid #cbd5e1;">Total</td>
                  <td style="font-size:15px;font-weight:700;color:${primaryColor};text-align:right;padding:8px;border-top:2px solid #cbd5e1;width:120px;">${escapeHtml(totalFormatted)}</td>
                </tr>
              </table>

              ${paymentHtml}
              ${notesHtml}

              <div style="margin-top:22px;text-align:center;">
                ${
                  input.shareablePdfUrl
                    ? `<a href="${escapeHtml(input.shareablePdfUrl)}" style="display:inline-block;background-color:${primaryColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:6px;margin:4px;">
                         Download / Share PDF
                       </a>`
                    : ''
                }
                <a href="${escapeHtml(input.appUrl)}" style="display:inline-block;background-color:${accentColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:6px;margin:4px;">
                  View ${escapeHtml(input.docType)} in Back Office
                </a>
              </div>
              <p style="margin-top:18px;font-size:12px;color:#64748b;text-align:center;">
                The branded PDF is attached. This copy was sent only to your signed-in account and was not emailed to the customer.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textLines = [
    `${input.tenantName} — ${input.docType} ${input.docNumber}`,
    `Customer: ${input.customerName}`,
    `Date: ${input.issuedDate}`,
    ...(input.customerPoNumber ? [`Customer PO: ${input.customerPoNumber}`] : []),
    '',
    'Line Items:',
    ...input.lines.map(
      (l) =>
        `- ${l.description} | ${Number(l.quantity)} ${l.unit} @ ${formatCents(l.unitPriceCents, input.currency)} = ${formatCents(l.lineTotalCents, input.currency)}`
    ),
    '',
    `Subtotal: ${subtotalFormatted}`,
    `${input.taxLabel}: ${taxFormatted}`,
    `Total: ${totalFormatted}`,
    ...(input.paymentInstructions ? ['', `Payment Instructions: ${input.paymentInstructions}`] : []),
    ...(input.notes ? ['', `Notes: ${input.notes}`] : []),
    ...(input.shareablePdfUrl ? ['', `Download / Share PDF: ${input.shareablePdfUrl}`] : []),
    '',
    `View in Back Office: ${input.appUrl}`,
    '(PDF attached. Sent to your account only — not sent to the customer.)'
  ]

  return { subject, html, text: textLines.join('\n') }
}

const MAX_MANUAL_SENDS_PER_HOUR = 3

/**
 * Sends a finalized quote copy (HTML + text + branded PDF attachment) EXCLUSIVELY
 * to the authenticated user's own email address resolved server-side from their user record.
 * Never accepts any recipient argument and never records a customer interaction.
 */
export async function sendQuoteEmailCopy(
  ctx: ActorContext,
  quoteId: string,
  trigger: 'approve' | 'manual'
): Promise<EmailCopyStatus> {
  const db = await getDb()

  // 1. Resolve authenticated user and verify tenant membership
  if (!ctx.userId) {
    if (trigger === 'manual') {
      throw Errors.validation('A signed-in user account is required to email a quote copy.')
    }
    return { status: 'skipped', reason: 'Caller has no associated user account.' }
  }

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, ctx.userId), isNull(schema.users.deletedAt)))

  if (!user || !user.isActive || !user.email) {
    if (trigger === 'manual') {
      throw Errors.validation('Authenticated user does not have an active email address.')
    }
    return { status: 'skipped', reason: 'Authenticated user has no email address.' }
  }

  // Verify user belongs to tenant (or is bwe_operator) — otherwise return NotFound without leaking quote existence
  if (user.role !== 'bwe_operator') {
    const [membership] = await db
      .select({ id: schema.tenantMemberships.id })
      .from(schema.tenantMemberships)
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, ctx.tenantId),
          eq(schema.tenantMemberships.userId, user.id),
          isNull(schema.tenantMemberships.deletedAt)
        )
      )
    if (!membership) {
      throw Errors.notFound('Quote', quoteId)
    }
  }

  // 2. Load quote strictly scoped to ctx.tenantId (tenant isolation -> NotFound if cross-tenant)
  const [quote] = await db
    .select()
    .from(schema.quotes)
    .where(
      and(
        eq(schema.quotes.id, quoteId),
        eq(schema.quotes.tenantId, ctx.tenantId),
        isNull(schema.quotes.deletedAt)
      )
    )
  if (!quote) {
    throw Errors.notFound('Quote', quoteId)
  }

  // 3. Finalized quotes only
  if (quote.status === 'draft') {
    throw Errors.validation('Approve the quote before emailing a copy.')
  }

  // 4. Load tenant, lines, customer
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, ctx.tenantId), isNull(schema.tenants.deletedAt)))
  if (!tenant) throw Errors.notFound('Tenant', ctx.tenantId)

  const [lines, [customer]] = await Promise.all([
    db
      .select()
      .from(schema.quoteLines)
      .where(eq(schema.quoteLines.quoteId, quote.id)),
    db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.id, quote.customerId), eq(schema.customers.tenantId, ctx.tenantId)))
  ])
  if (!customer) throw Errors.notFound('Customer', quote.customerId)

  // 5. Check sender config (never silently fall back to another sender)
  const senderAddress = tenant.settings?.quoteEmailFromAddress?.trim() || ''
  if (!senderAddress) {
    const reason = 'Quote email sender not configured for this business.'
    await db.insert(schema.quoteEmailSends).values({
      tenantId: ctx.tenantId,
      quoteId: quote.id,
      quoteVersion: quote.version,
      userId: user.id,
      trigger,
      recipient: user.email,
      sender: '',
      status: 'skipped',
      errorCode: 'SENDER_NOT_CONFIGURED',
      errorMessage: reason
    })
    return { status: 'skipped', sentTo: user.email, reason }
  }

  // 6. Deduplication for approve-triggered sends (keyed on quoteId + version + userId)
  const approveIdemKey =
    trigger === 'approve' ? `approve:${quote.id}:v${quote.version}:${user.id}` : null

  if (approveIdemKey) {
    const [existingSend] = await db
      .select()
      .from(schema.quoteEmailSends)
      .where(
        and(
          eq(schema.quoteEmailSends.tenantId, ctx.tenantId),
          eq(schema.quoteEmailSends.idempotencyKey, approveIdemKey)
        )
      )
    if (existingSend) {
      return {
        status: existingSend.status as 'sent' | 'failed' | 'skipped',
        sentTo: existingSend.recipient,
        from: senderAddress,
        messageId: existingSend.resendMessageId || undefined,
        reason: existingSend.errorMessage || undefined
      }
    }
  }

  // 7. Rate limit for manual email_quote_copy (max 3 per quote per user per hour)
  if (trigger === 'manual') {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const [rateRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quoteEmailSends)
      .where(
        and(
          eq(schema.quoteEmailSends.tenantId, ctx.tenantId),
          eq(schema.quoteEmailSends.quoteId, quote.id),
          eq(schema.quoteEmailSends.userId, user.id),
          eq(schema.quoteEmailSends.trigger, 'manual'),
          gte(schema.quoteEmailSends.createdAt, oneHourAgo)
        )
      )
    if ((rateRow?.count ?? 0) >= MAX_MANUAL_SENDS_PER_HOUR) {
      throw Errors.tooManyRequests(3600)
    }
  }

  // 8. Resolve Reply-To (configured reply-to -> tenant owner email -> tenant email -> senderAddress)
  // Never emit a non-routable `.local` Reply-To header, which triggers Microsoft 365 / Gmail quarantine!
  let replyTo = tenant.settings?.quoteEmailReplyTo?.trim() || ''
  if (!replyTo || isNonRoutableEmail(replyTo)) {
    const [ownerRow] = await db
      .select({ email: schema.users.email })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
      .where(
        and(
          eq(schema.tenantMemberships.tenantId, ctx.tenantId),
          eq(schema.tenantMemberships.role, 'owner'),
          isNull(schema.tenantMemberships.deletedAt),
          isNull(schema.users.deletedAt)
        )
      )
      .orderBy(desc(schema.tenantMemberships.createdAt))
      .limit(1)
    const candidate = ownerRow?.email || tenant.email || ''
    replyTo = candidate && !isNonRoutableEmail(candidate) ? candidate : senderAddress
  }

  // 9. Fetch stored branded PDF (or regenerate if missing or tenant branding updated more recently)
  let pdfBytes: Buffer | null = null
  if (quote.pdfAttachmentId) {
    try {
      const stored = await getAttachmentWithBytes(ctx.tenantId, quote.pdfAttachmentId)
      const brandingUpdatedAfterPdf =
        tenant.updatedAt && stored.attachment.createdAt && tenant.updatedAt > stored.attachment.createdAt
      if (!brandingUpdatedAfterPdf && stored.bytes.length > 0) {
        pdfBytes = stored.bytes
      }
    } catch {
      pdfBytes = null
    }
  }

  if (!pdfBytes) {
    const generated = await generateBrandedDocumentPdf({
      docType: 'QUOTE',
      docNumber: quote.quoteNumber,
      status: quote.status,
      issuedDate: (quote.sentAt || quote.createdAt).toISOString().slice(0, 10),
      dueOrValidLabel: 'Valid Until',
      dueOrValidDate: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
      customerPoNumber: quote.customerPoNumber,
      tenant: {
        name: tenant.name,
        legalName: tenant.legalName,
        contactName: tenant.contactName,
        website: tenant.website,
        email: tenant.email,
        phone: tenant.phone,
        address: tenant.address,
        branding: tenant.branding,
        currency: tenant.settings.currency,
        taxLabel: tenant.taxSettings.taxLabel
      },
      customer: {
        name: customer.name,
        companyName: customer.companyName,
        email: customer.email,
        phone: customer.phone
      },
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        attributes: l.attributes
      })),
      subtotalCents: quote.subtotalCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
      notes: quote.notes
    })
    pdfBytes = Buffer.from(generated)
  }

  // 10. Render HTML + plain-text email (with signed mobile-friendly shareable PDF link)
  const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const fromName = sanitizeHeaderValue(tenant.settings?.quoteEmailFromName || tenant.name)
  const fromHeader = `${fromName} <${senderAddress}>`
  const attachmentFilename = `${quote.quoteNumber}_${slugifyFilenamePart(customer.name)}.pdf`
  const shareablePdfUrl = await buildShareablePdfUrl(baseUrl, {
    tenantId: ctx.tenantId,
    docType: 'quote',
    docId: quote.id
  })

  const rendered = renderDocumentCopyEmail({
    docType: 'Quote',
    docNumber: quote.quoteNumber,
    issuedDate: (quote.sentAt || quote.createdAt).toISOString().slice(0, 10),
    customerName: customer.name,
    customerPoNumber: quote.customerPoNumber,
    tenantName: tenant.name,
    logoUrl:
      tenant.branding?.logoUrl ||
      (tenant.branding?.logoDataUrl ? `${baseUrl}/api/v1/tenant/logo/${tenant.id}` : null),
    primaryColor: tenant.branding?.primaryColor,
    accentColor: tenant.branding?.accentColor,
    paymentInstructions: tenant.branding?.paymentInstructions || null,
    notes: quote.notes,
    appUrl: `${baseUrl}/quotes?id=${quote.id}`,
    shareablePdfUrl,
    currency: tenant.settings.currency || 'USD',
    taxLabel: tenant.taxSettings.taxLabel || 'Tax',
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: quote.subtotalCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents
  })

  // 11. Dispatch email (STRICTLY to user.email only)
  const sendRes = await sendEmail({
    from: fromHeader,
    to: [user.email],
    replyTo: replyTo || undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [
      {
        filename: attachmentFilename,
        contentBase64: pdfBytes.toString('base64'),
        contentType: 'application/pdf'
      }
    ],
    idempotencyKey: approveIdemKey || undefined
  })

  const status: 'sent' | 'failed' = sendRes.ok ? 'sent' : 'failed'

  // 12. Record send log + audit entry (NEVER a customer interaction!)
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.quoteEmailSends)
      .values({
        tenantId: ctx.tenantId,
        quoteId: quote.id,
        quoteVersion: quote.version,
        userId: user.id,
        trigger,
        recipient: user.email,
        sender: senderAddress,
        replyTo: replyTo || null,
        resendMessageId: sendRes.messageId ?? null,
        status,
        errorCode: sendRes.errorCode ?? null,
        errorMessage: sendRes.errorMessage ?? null,
        idempotencyKey: approveIdemKey
      })
      .onConflictDoNothing()

    await recordAudit(tx, ctx, {
      action: sendRes.ok ? 'quote.email_copy.sent' : 'quote.email_copy.failed',
      entityType: 'quote',
      entityId: quote.id,
      afterState: {
        quoteNumber: quote.quoteNumber,
        quoteVersion: quote.version,
        trigger,
        sender: senderAddress,
        status,
        resendMessageId: sendRes.messageId ?? null,
        errorCode: sendRes.errorCode ?? null
      }
    })
  })

  return {
    status,
    sentTo: user.email,
    from: senderAddress,
    messageId: sendRes.messageId,
    ...(sendRes.ok ? {} : { reason: sendRes.errorMessage || 'Failed to deliver email copy.' })
  }
}
