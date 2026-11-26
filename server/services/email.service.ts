import { logger } from '../utils/logger'

export interface EmailAttachmentInput {
  filename: string
  contentBase64: string
  contentType?: string
}

export interface EmailSendRequest {
  from: string
  to: string[]
  replyTo?: string
  subject: string
  html?: string
  text: string
  attachments?: EmailAttachmentInput[]
  idempotencyKey?: string
}

export interface EmailSendResult {
  ok: boolean
  provider: 'resend' | 'console' | 'mock'
  messageId?: string
  status?: number
  errorCode?: string
  errorMessage?: string
}

export type EmailTransport = (req: EmailSendRequest) => Promise<EmailSendResult>

let _customTransport: EmailTransport | null = null

/**
 * Allows automated tests to inject a mock email transport so no real emails are sent.
 */
export function setEmailTransportForTests(transport: EmailTransport | null) {
  _customTransport = transport
}

/**
 * Verifies whether a sender email's domain is verified in Resend (when the API key
 * has permission to read /domains). If the key is sending-only (401/403 on /domains),
 * returns { checked: false } so Resend's send-time check handles it cleanly.
 */
export async function checkSenderDomainVerifiedInResend(
  fromAddress: string
): Promise<{ checked: boolean; verified: boolean; domain: string; reason?: string }> {
  const domain = fromAddress.split('@')[1]?.trim().toLowerCase() || ''
  if (!domain) {
    return { checked: true, verified: false, domain: '', reason: 'Invalid email address format' }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey || process.env.EMAIL_PROVIDER !== 'resend' || process.env.VITEST === 'true') {
    return { checked: false, verified: true, domain }
  }

  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (res.status === 401 || res.status === 403) {
      // Sending-only API key cannot list domains; defer to Resend send-time verification
      return { checked: false, verified: true, domain }
    }
    if (!res.ok) {
      return { checked: false, verified: true, domain }
    }
    const json = (await res.json()) as { data?: Array<{ name?: string; status?: string }> }
    const domains = Array.isArray(json.data) ? json.data : []
    const match = domains.find((d) => d.name?.toLowerCase() === domain && d.status === 'verified')
    if (!match) {
      return {
        checked: true,
        verified: false,
        domain,
        reason: `Domain "${domain}" is not verified in Resend. Verify the domain in Resend before using it as a sender.`
      }
    }
    return { checked: true, verified: true, domain }
  } catch {
    return { checked: false, verified: true, domain }
  }
}

export async function sendEmail(req: EmailSendRequest): Promise<EmailSendResult> {
  if (_customTransport) {
    return _customTransport(req)
  }

  const provider = process.env.EMAIL_PROVIDER || 'console'
  if (provider === 'resend') {
    const apiKey = process.env.RESEND_API_KEY?.trim()
    if (!apiKey) {
      return {
        ok: false,
        provider: 'resend',
        errorCode: 'MISSING_API_KEY',
        errorMessage: 'RESEND_API_KEY is not configured'
      }
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
      if (req.idempotencyKey) {
        headers['Idempotency-Key'] = req.idempotencyKey
      }

      const payload: Record<string, unknown> = {
        from: req.from,
        to: req.to,
        subject: req.subject,
        text: req.text
      }
      if (req.html) payload.html = req.html
      if (req.replyTo) payload.reply_to = req.replyTo
      if (req.attachments && req.attachments.length > 0) {
        payload.attachments = req.attachments.map((att) => ({
          filename: att.filename,
          content: att.contentBase64,
          ...(att.contentType ? { content_type: att.contentType } : {})
        }))
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      const body = (await res.json().catch(() => ({}))) as {
        id?: string
        name?: string
        message?: string
      }

      if (!res.ok) {
        logger.warn('Resend email send failed', {
          status: res.status,
          errorCode: body.name || `HTTP_${res.status}`
        })
        return {
          ok: false,
          provider: 'resend',
          status: res.status,
          errorCode: body.name || `HTTP_${res.status}`,
          errorMessage: body.message || `Resend returned HTTP ${res.status}`
        }
      }

      logger.info('Resend email sent', { messageId: body.id })
      return {
        ok: true,
        provider: 'resend',
        status: res.status,
        messageId: body.id
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error sending email'
      logger.warn('Resend email transport exception', { errorMessage: message })
      return {
        ok: false,
        provider: 'resend',
        errorCode: 'NETWORK_ERROR',
        errorMessage: message
      }
    }
  }

  // Local dev console fallback (never logs body, PDF bytes, or secrets)
  logger.info('Email dispatched via console provider', {
    attachmentCount: req.attachments?.length ?? 0
  })
  return {
    ok: true,
    provider: 'console',
    messageId: `console_${Date.now()}`
  }
}
