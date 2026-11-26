import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from 'pdf-lib'
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

function toWinAnsiSafe(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

async function resolveLogoImage(
  pdfDoc: PDFDocument,
  branding: TenantBranding | undefined
): Promise<PDFImage | null> {
  if (!branding) return null
  let bytes: Buffer | null = null

  if (branding.logoDataUrl && branding.logoDataUrl.startsWith('data:image/')) {
    const commaIdx = branding.logoDataUrl.indexOf(',')
    if (commaIdx > 0) {
      const b64 = branding.logoDataUrl.slice(commaIdx + 1).trim()
      if (b64) bytes = Buffer.from(b64, 'base64')
    }
  } else if (branding.logoUrl && /^https?:\/\//i.test(branding.logoUrl)) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const res = await fetch(branding.logoUrl, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        const arr = await res.arrayBuffer()
        if (arr.byteLength > 0 && arr.byteLength <= 2_000_000) {
          bytes = Buffer.from(arr)
        }
      }
    } catch {
      return null
    }
  }

  if (!bytes || bytes.length < 4) return null

  try {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
    if (isPng) return await pdfDoc.embedPng(bytes)
    if (isJpeg) return await pdfDoc.embedJpg(bytes)
    try {
      return await pdfDoc.embedPng(bytes)
    } catch {
      return await pdfDoc.embedJpg(bytes)
    }
  } catch {
    return null
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const safe = toWinAnsiSafe(text).trim()
  if (!safe) return []
  const words = safe.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current ? `${current} ${w}` : w).length <= maxChars) {
      current = current ? `${current} ${w}` : w
    } else {
      if (current) lines.push(current)
      current = w.length > maxChars ? w.slice(0, maxChars) : w
    }
  }
  if (current) lines.push(current)
  return lines
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
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const primary = hexToRgb(input.tenant.branding?.primaryColor || '#1e293b')
  const accent = hexToRgb(input.tenant.branding?.accentColor || '#b45309')
  const muted = rgb(0.4, 0.45, 0.52)
  const dark = rgb(0.1, 0.12, 0.16)
  const lightBg = rgb(0.96, 0.97, 0.98)
  const currency = input.tenant.currency || 'USD'

  const embeddedLogo = await resolveLogoImage(pdfDoc, input.tenant.branding)
  const width = 612
  const height = 792

  const drawTableHeader = (pg: PDFPage, yPos: number) => {
    pg.drawRectangle({ x: 44, y: yPos - 6, width: width - 88, height: 24, color: lightBg })
    pg.drawText('DESCRIPTION', { x: 52, y: yPos + 2, size: 8.5, font: fontBold, color: muted })
    pg.drawText('QTY', { x: 340, y: yPos + 2, size: 8.5, font: fontBold, color: muted })
    pg.drawText('UNIT PRICE', { x: 405, y: yPos + 2, size: 8.5, font: fontBold, color: muted })
    pg.drawText('TOTAL', { x: 495, y: yPos + 2, size: 8.5, font: fontBold, color: muted })
  }

  let page = pdfDoc.addPage([width, height])

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

  // Optional Tenant Logo with crisp white backing so dark/transparent logos stay visible
  let textStartX = 44
  if (embeddedLogo) {
    const maxH = 62
    const maxW = 86
    const scale = Math.min(maxW / embeddedLogo.width, maxH / embeddedLogo.height, 1)
    const drawW = embeddedLogo.width * scale
    const drawH = embeddedLogo.height * scale
    const pad = 6
    const badgeX = 36
    const badgeY = height - headerHeight / 2 - (drawH + pad * 2) / 2
    page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: drawW + pad * 2,
      height: drawH + pad * 2,
      color: rgb(1, 1, 1)
    })
    page.drawImage(embeddedLogo, {
      x: badgeX + pad,
      y: badgeY + pad,
      width: drawW,
      height: drawH
    })
    textStartX = badgeX + drawW + pad * 2 + 14
  }

  // Tenant Name, Custom Header Text & Contact Info
  page.drawText(toWinAnsiSafe(input.tenant.name).slice(0, 36), {
    x: textStartX,
    y: height - 38,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  if (input.tenant.branding?.headerText) {
    page.drawText(toWinAnsiSafe(input.tenant.branding.headerText).slice(0, 56), {
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
    page.drawText(toWinAnsiSafe(tenantLine1).slice(0, 62), {
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
    page.drawText(toWinAnsiSafe(tenantLine2).slice(0, 66), {
      x: textStartX,
      y: height - 84,
      size: 8,
      font: fontRegular,
      color: rgb(0.8, 0.84, 0.9)
    })
  }
  if (tenantAddr && input.tenant.website) {
    page.drawText(toWinAnsiSafe(tenantAddr).slice(0, 66), {
      x: textStartX,
      y: height - 96,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.75, 0.8, 0.86)
    })
  }

  // Document Type & Number (right aligned)
  page.drawText(input.docType, {
    x: width - 175,
    y: height - 42,
    size: 11,
    font: fontBold,
    color: rgb(0.95, 0.82, 0.55)
  })
  page.drawText(toWinAnsiSafe(input.docNumber).slice(0, 20), {
    x: width - 175,
    y: height - 64,
    size: 17,
    font: fontBold,
    color: rgb(1, 1, 1)
  })
  page.drawText(`Status: ${toWinAnsiSafe(input.status).toUpperCase()}`, {
    x: width - 175,
    y: height - 82,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.85, 0.88, 0.92)
  })

  // Bill To + Metadata
  let y = height - 135
  page.drawText('PREPARED FOR', { x: 44, y, size: 8.5, font: fontBold, color: muted })
  page.drawText('DOCUMENT DETAILS', { x: 350, y, size: 8.5, font: fontBold, color: muted })

  y -= 18
  page.drawText(toWinAnsiSafe(input.customer.name).slice(0, 44), { x: 44, y, size: 12, font: fontBold, color: dark })
  page.drawText(`Date: ${toWinAnsiSafe(input.issuedDate)}`, { x: 350, y, size: 10, font: fontRegular, color: dark })

  if (input.customer.companyName) {
    y -= 15
    page.drawText(toWinAnsiSafe(input.customer.companyName).slice(0, 48), { x: 44, y, size: 10, font: fontRegular, color: dark })
  }
  if (input.dueOrValidDate) {
    page.drawText(`${toWinAnsiSafe(input.dueOrValidLabel)}: ${toWinAnsiSafe(input.dueOrValidDate)}`, {
      x: 350,
      y: height - 168,
      size: 10,
      font: fontRegular,
      color: dark
    })
  }
  if (input.customerPoNumber) {
    page.drawText(`Customer PO: ${toWinAnsiSafe(input.customerPoNumber).slice(0, 28)}`, {
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
    page.drawText(toWinAnsiSafe(custContact).slice(0, 52), { x: 44, y, size: 9.5, font: fontRegular, color: muted })
  }

  // Line Items Table Header
  y = Math.min(y - 34, height - 220)
  drawTableHeader(page, y)
  y -= 24

  const addContinuationPage = () => {
    page = pdfDoc.addPage([width, height])
    page.drawText(`${toWinAnsiSafe(input.tenant.name)} - ${toWinAnsiSafe(input.docNumber)} (continued)`, {
      x: 44,
      y: height - 40,
      size: 9.5,
      font: fontBold,
      color: muted
    })
    y = height - 72
    drawTableHeader(page, y)
    y -= 24
  }

  for (const line of input.lines) {
    const attrSummary =
      line.attributes && Object.keys(line.attributes).length > 0
        ? toWinAnsiSafe(
            Object.entries(line.attributes)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' | ')
          ).slice(0, 72)
        : ''
    const rowHeight = attrSummary ? 35 : 22

    if (y - rowHeight < 80) {
      addContinuationPage()
    }

    page.drawText(toWinAnsiSafe(line.description).slice(0, 54), { x: 52, y, size: 9.5, font: fontBold, color: dark })
    page.drawText(`${Number(line.quantity)} ${toWinAnsiSafe(line.unit).slice(0, 10)}`, {
      x: 340,
      y,
      size: 9,
      font: fontRegular,
      color: dark
    })
    page.drawText(formatCents(line.unitPriceCents, currency), {
      x: 405,
      y,
      size: 9,
      font: fontRegular,
      color: dark
    })
    page.drawText(formatCents(line.lineTotalCents, currency), {
      x: 495,
      y,
      size: 9.5,
      font: fontBold,
      color: dark
    })

    if (attrSummary) {
      y -= 13
      page.drawText(attrSummary, { x: 52, y, size: 8, font: fontRegular, color: muted })
    }

    y -= 20
    page.drawLine({
      start: { x: 44, y: y + 10 },
      end: { x: width - 44, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.88, 0.9, 0.93)
    })
  }

  if (y < 210) {
    page = pdfDoc.addPage([width, height])
    y = height - 72
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
  page.drawText(toWinAnsiSafe(input.tenant.taxLabel || 'Tax').slice(0, 22), {
    x: totalsX,
    y,
    size: 10,
    font: fontRegular,
    color: muted
  })
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
  let infoY = y - 34
  const paymentInstructions = input.tenant.branding?.paymentInstructions
  if (paymentInstructions) {
    const payLines = wrapText(paymentInstructions, 92).slice(0, 3)
    const boxH = 18 + payLines.length * 13
    if (infoY - boxH < 64) {
      page = pdfDoc.addPage([width, height])
      infoY = height - 72
    }
    page.drawRectangle({ x: 44, y: infoY - boxH + 10, width: width - 88, height: boxH, color: lightBg })
    page.drawText('PAYMENT INSTRUCTIONS', { x: 52, y: infoY - 3, size: 8, font: fontBold, color: accent })
    payLines.forEach((pl, idx) => {
      page.drawText(pl, { x: 52, y: infoY - 17 - idx * 13, size: 9.5, font: fontBold, color: dark })
    })
    infoY -= boxH + 14
  }

  const termsText =
    input.docType === 'QUOTE' ? input.tenant.branding?.quoteTerms : input.tenant.branding?.invoiceTerms
  const combinedNotes = [input.notes, termsText].filter(Boolean).join(' - ')
  if (combinedNotes) {
    const noteLines = wrapText(combinedNotes, 95).slice(0, 8)
    if (infoY - (16 + noteLines.length * 12) < 64) {
      page = pdfDoc.addPage([width, height])
      infoY = height - 72
    }
    page.drawText('NOTES & TERMS', { x: 44, y: infoY, size: 8.5, font: fontBold, color: muted })
    noteLines.forEach((nl, idx) => {
      page.drawText(nl, { x: 44, y: infoY - 14 - idx * 12, size: 9, font: fontRegular, color: dark })
    })
  }

  // Draw footers & page numbers across all pages
  const allPages = pdfDoc.getPages()
  allPages.forEach((pg, idx) => {
    pg.drawLine({
      start: { x: 44, y: 48 },
      end: { x: width - 44, y: 48 },
      thickness: 0.5,
      color: rgb(0.86, 0.88, 0.92)
    })
    if (input.tenant.branding?.footerText) {
      pg.drawText(toWinAnsiSafe(input.tenant.branding.footerText).slice(0, 88), {
        x: 44,
        y: 32,
        size: 8.5,
        font: fontRegular,
        color: muted
      })
    }
    pg.drawText(`Page ${idx + 1} of ${allPages.length}`, {
      x: width - 102,
      y: 32,
      size: 8,
      font: fontRegular,
      color: muted
    })
  })

  return pdfDoc.save()
}
