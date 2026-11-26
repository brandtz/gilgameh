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
    contactName?: string | null
    website?: string | null
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
  const headerHeight = 108
  page.drawRectangle({
    x: 0,
    y: height - headerHeight,
    width,
    height: headerHeight,
    color: primary
  })
  page.drawRectangle({
    x: 0,
    y: height - headerHeight - 5,
    width,
    height: 5,
    color: accent
  })

  // Optional Tenant Logo (PNG or JPEG data URL stored per-tenant)
  let textStartX = 44
  const logoDataUrl = input.tenant.branding?.logoDataUrl
  if (logoDataUrl && logoDataUrl.startsWith('data:image/')) {
    try {
      const [meta, b64] = logoDataUrl.split(',')
      if (b64) {
        const imgBytes = Buffer.from(b64, 'base64')
        const embedded = meta.includes('png')
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes)
        const maxH = 62
        const maxW = 90
        const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1)
        const drawW = embedded.width * scale
        const drawH = embedded.height * scale
        page.drawImage(embedded, {
          x: 40,
          y: height - headerHeight / 2 - drawH / 2,
          width: drawW,
          height: drawH
        })
        textStartX = 40 + drawW + 14
      }
    } catch {
      // Ignore malformed logo gracefully so PDF generation never fails
    }
  }

  // Tenant Name, Custom Header Text & Contact Info
  page.drawText(input.tenant.name, {
    x: textStartX,
    y: height - 38,
    size: 19,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  if (input.tenant.branding?.headerText) {
    page.drawText(input.tenant.branding.headerText.slice(0, 68), {
      x: textStartX,
      y: height - 54,
      size: 9.5,
      font: fontBold,
      color: rgb(0.95, 0.85, 0.6)
    })
  }
  const tenantLine1 = [input.tenant.legalName, input.tenant.contactName ? `Attn: ${input.tenant.contactName}` : null]
    .filter(Boolean)
    .join('  |  ')
  if (tenantLine1) {
    page.drawText(tenantLine1.slice(0, 72), {
      x: textStartX,
      y: height - 70,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.86, 0.89, 0.93)
    })
  }
  const tenantAddr = [
    input.tenant.address?.line1,
    [input.tenant.address?.city, input.tenant.address?.state, input.tenant.address?.postalCode].filter(Boolean).join(' ')
  ]
    .filter(Boolean)
    .join(', ')
  const tenantLine2 = [input.tenant.phone, input.tenant.email, input.tenant.website || tenantAddr]
    .filter(Boolean)
    .join('  |  ')
  if (tenantLine2) {
    page.drawText(tenantLine2.slice(0, 78), {
      x: textStartX,
      y: height - 84,
      size: 8,
      font: fontRegular,
      color: rgb(0.8, 0.84, 0.9)
    })
  }
  if (tenantAddr && input.tenant.website) {
    page.drawText(tenantAddr.slice(0, 78), {
      x: textStartX,
      y: height - 96,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.75, 0.8, 0.86)
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

  // Payment Instructions ("Make checks payable to...") & Notes
  let infoY = Math.max(y - 36, 130)
  const paymentInstructions = input.tenant.branding?.paymentInstructions
  if (paymentInstructions) {
    page.drawRectangle({ x: 44, y: infoY - 26, width: width - 88, height: 38, color: lightBg })
    page.drawText('PAYMENT INSTRUCTIONS', { x: 52, y: infoY - 2, size: 8, font: fontBold, color: accent })
    page.drawText(paymentInstructions.slice(0, 105), {
      x: 52,
      y: infoY - 16,
      size: 9.5,
      font: fontBold,
      color: dark
    })
    infoY -= 44
  }

  const termsText =
    input.docType === 'QUOTE' ? input.tenant.branding?.quoteTerms : input.tenant.branding?.invoiceTerms
  const combinedNotes = [input.notes, termsText].filter(Boolean).join(' — ')
  if (combinedNotes) {
    page.drawText('NOTES & TERMS', { x: 44, y: infoY, size: 8.5, font: fontBold, color: muted })
    page.drawText(combinedNotes.slice(0, 115), {
      x: 44,
      y: infoY - 14,
      size: 9,
      font: fontRegular,
      color: dark
    })
  }

  // Footer
  if (input.tenant.branding?.footerText) {
    page.drawLine({
      start: { x: 44, y: 50 },
      end: { x: width - 44, y: 50 },
      thickness: 0.5,
      color: rgb(0.86, 0.88, 0.92)
    })
    page.drawText(input.tenant.branding.footerText.slice(0, 105), {
      x: 44,
      y: 34,
      size: 8.5,
      font: fontRegular,
      color: muted
    })
  }

  return pdfDoc.save()
}
