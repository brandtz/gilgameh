import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { formatCents } from '../utils/money'
import type { AddressJson, TenantBranding } from '../db/schema'

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return rgb(0.12, 0.16, 0.23)
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return rgb(r, g, b)
}

export interface PdfLineItem {
  description: string
  quantity: string | number
  unit: string
  unitPriceCents: number
  lineTotalCents: number
  attributes?: Record<string, unknown>
}

export interface PdfDocumentInput {
  docType: 'QUOTE' | 'INVOICE'
  docNumber: string
  status: string
  issuedDate: string
  dueOrValidLabel: string
  dueOrValidDate?: string | null
  customerPoNumber?: string | null
  tenant: {
    name: string
    legalName?: string | null
    email?: string | null
    phone?: string | null
    address?: AddressJson
    branding: TenantBranding
    currency?: string
    taxLabel?: string
  }
  customer: {
    name: string
    companyName?: string | null
    email?: string | null
    phone?: string | null
    address?: AddressJson
  }
  lines: PdfLineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  amountPaidCents?: number
  balanceDueCents?: number
  notes?: string | null
}

export async function generateBrandedDocumentPdf(input: PdfDocumentInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([612, 792]) // US Letter
  const { width, height } = page.getSize()

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const primary = hexToRgb(input.tenant.branding?.primaryColor || '#1e293b')
  const accent = hexToRgb(input.tenant.branding?.accentColor || '#b45309')
  const muted = rgb(0.4, 0.45, 0.52)
  const dark = rgb(0.1, 0.12, 0.16)
  const lightBg = rgb(0.96, 0.97, 0.98)
  const currency = input.tenant.currency || 'USD'

  // Top Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 96,
    width,
    height: 96,
    color: primary
  })
  page.drawRectangle({
    x: 0,
    y: height - 101,
    width,
    height: 5,
    color: accent
  })

  // Tenant Name & Info
  page.drawText(input.tenant.name, {
    x: 44,
    y: height - 46,
    size: 20,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  const tenantSub = [input.tenant.legalName, input.tenant.email, input.tenant.phone]
    .filter(Boolean)
    .join('  |  ')
  if (tenantSub) {
    page.drawText(tenantSub.slice(0, 85), {
      x: 44,
      y: height - 68,
      size: 9,
      font: fontRegular,
      color: rgb(0.85, 0.88, 0.92)
    })
  }

  // Document Type & Number (right aligned)
  page.drawText(input.docType, {
    x: width - 190,
    y: height - 42,
    size: 11,
    font: fontBold,
    color: rgb(0.95, 0.82, 0.55)
  })
  page.drawText(input.docNumber, {
    x: width - 190,
    y: height - 64,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  page.drawText(`Status: ${input.status.toUpperCase()}`, {
    x: width - 190,
    y: height - 82,
    size: 9,
    font: fontRegular,
    color: rgb(0.85, 0.88, 0.92)
  })

  // Bill To + Metadata
  let y = height - 135
  page.drawText('PREPARED FOR', { x: 44, y, size: 8.5, font: fontBold, color: muted })
  page.drawText('DOCUMENT DETAILS', { x: 350, y, size: 8.5, font: fontBold, color: muted })

  y -= 18
  page.drawText(input.customer.name, { x: 44, y, size: 12, font: fontBold, color: dark })
  page.drawText(`Date: ${input.issuedDate}`, { x: 350, y, size: 10, font: fontRegular, color: dark })

  if (input.customer.companyName) {
    y -= 15
    page.drawText(input.customer.companyName, { x: 44, y, size: 10, font: fontRegular, color: dark })
  }
  if (input.dueOrValidDate) {
    page.drawText(`${input.dueOrValidLabel}: ${input.dueOrValidDate}`, {
      x: 350,
      y: height - 168,
      size: 10,
      font: fontRegular,
      color: dark
    })
  }
  if (input.customerPoNumber) {
    page.drawText(`Customer PO: ${input.customerPoNumber}`, {
      x: 350,
      y: height - 183,
      size: 10,
      font: fontBold,
      color: accent
    })
  }

  const custContact = [input.customer.email, input.customer.phone].filter(Boolean).join('  |  ')
  if (custContact) {
    y -= 15
    page.drawText(custContact.slice(0, 55), { x: 44, y, size: 9.5, font: fontRegular, color: muted })
  }

  // Line Items Table Header
  y = Math.min(y - 34, height - 220)
  page.drawRectangle({ x: 44, y: y - 6, width: width - 88, height: 24, color: lightBg })
  page.drawText('DESCRIPTION', { x: 52, y: y + 2, size: 8.5, font: fontBold, color: muted })
  page.drawText('QTY', { x: 340, y: y + 2, size: 8.5, font: fontBold, color: muted })
  page.drawText('UNIT PRICE', { x: 405, y: y + 2, size: 8.5, font: fontBold, color: muted })
  page.drawText('TOTAL', { x: 495, y: y + 2, size: 8.5, font: fontBold, color: muted })

  y -= 24

  for (const line of input.lines) {
    if (y < 170) break
    const desc = line.description.slice(0, 56)
    page.drawText(desc, { x: 52, y, size: 10, font: fontBold, color: dark })
    page.drawText(`${Number(line.quantity)} ${line.unit}`, {
      x: 340,
      y,
      size: 9.5,
      font: fontRegular,
      color: dark
    })
    page.drawText(formatCents(line.unitPriceCents, currency), {
      x: 405,
      y,
      size: 9.5,
      font: fontRegular,
      color: dark
    })
    page.drawText(formatCents(line.lineTotalCents, currency), {
      x: 495,
      y,
      size: 10,
      font: fontBold,
      color: dark
    })

    if (line.attributes && Object.keys(line.attributes).length > 0) {
      y -= 13
      const attrSummary = Object.entries(line.attributes)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' | ')
        .slice(0, 72)
      page.drawText(attrSummary, { x: 52, y, size: 8.5, font: fontRegular, color: muted })
    }

    y -= 20
    page.drawLine({
      start: { x: 44, y: y + 10 },
      end: { x: width - 44, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.88, 0.9, 0.93)
    })
  }

  // Totals Box
  y -= 10
  const totalsX = 375
  page.drawText('Subtotal', { x: totalsX, y, size: 10, font: fontRegular, color: muted })
  page.drawText(formatCents(input.subtotalCents, currency), {
    x: 495,
    y,
    size: 10,
    font: fontRegular,
    color: dark
  })

  y -= 18
  page.drawText(input.tenant.taxLabel || 'Tax', { x: totalsX, y, size: 10, font: fontRegular, color: muted })
  page.drawText(formatCents(input.taxCents, currency), {
    x: 495,
    y,
    size: 10,
    font: fontRegular,
    color: dark
  })

  y -= 24
  page.drawRectangle({ x: totalsX - 8, y: y - 6, width: width - 44 - (totalsX - 8), height: 26, color: lightBg })
  page.drawText('TOTAL', { x: totalsX, y: y + 2, size: 11, font: fontBold, color: primary })
  page.drawText(formatCents(input.totalCents, currency), {
    x: 495,
    y: y + 2,
    size: 11,
    font: fontBold,
    color: primary
  })

  if (input.docType === 'INVOICE' && input.balanceDueCents !== undefined) {
    y -= 22
    page.drawText('Amount Paid', { x: totalsX, y, size: 9.5, font: fontRegular, color: muted })
    page.drawText(formatCents(input.amountPaidCents || 0, currency), {
      x: 495,
      y,
      size: 9.5,
      font: fontRegular,
      color: dark
    })
    y -= 18
    page.drawText('Balance Due', { x: totalsX, y, size: 10.5, font: fontBold, color: accent })
    page.drawText(formatCents(input.balanceDueCents, currency), {
      x: 495,
      y,
      size: 10.5,
      font: fontBold,
      color: accent
    })
  }

  // Notes
  if (input.notes) {
    const notesY = Math.max(y - 45, 95)
    page.drawText('NOTES', { x: 44, y: notesY, size: 8.5, font: fontBold, color: muted })
    page.drawText(input.notes.slice(0, 120), {
      x: 44,
      y: notesY - 15,
      size: 9.5,
      font: fontRegular,
      color: dark
    })
  }

  // Footer
  if (input.tenant.branding?.footerText) {
    page.drawText(input.tenant.branding.footerText.slice(0, 95), {
      x: 44,
      y: 36,
      size: 8.5,
      font: fontRegular,
      color: muted
    })
  }

  return pdfDoc.save()
}
