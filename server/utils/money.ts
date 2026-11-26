import { Errors } from './errors'

export interface LineMathInput {
  quantity: number
  unitPriceCents: number
  taxable?: boolean
  taxRateBps?: number | null
  // Optional client-supplied values to verify (server is the referee)
  lineSubtotalCents?: number
  lineTaxCents?: number
  lineTotalCents?: number
}

export interface ComputedLineMath {
  quantityStr: string
  unitPriceCents: number
  taxable: boolean
  effectiveTaxRateBps: number
  lineSubtotalCents: number
  lineTaxCents: number
  lineTotalCents: number
}

export interface ComputedDocumentMath {
  lines: ComputedLineMath[]
  subtotalCents: number
  taxCents: number
  totalCents: number
}

export function computeDocumentTotals(
  lines: LineMathInput[],
  defaultTaxRateBps: number,
  clientTotals?: {
    subtotalCents?: number
    taxCents?: number
    totalCents?: number
  }
): ComputedDocumentMath {
  let subtotalCents = 0
  let taxCents = 0

  const computedLines: ComputedLineMath[] = lines.map((line) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw Errors.unprocessable('Line quantity must be a positive number')
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw Errors.unprocessable('Unit price must be a non-negative integer in cents')
    }

    const taxable = line.taxable ?? true
    const effectiveTaxRateBps = taxable
      ? (line.taxRateBps !== undefined && line.taxRateBps !== null ? line.taxRateBps : defaultTaxRateBps)
      : 0

    // Exact integer-cent rounding using milli-units for 3 decimal places
    const qtyMilli = Math.round(line.quantity * 1000)
    const lineSubtotalCents = Math.round((qtyMilli * line.unitPriceCents) / 1000)
    const lineTaxCents = Math.round((lineSubtotalCents * effectiveTaxRateBps) / 10_000)
    const lineTotalCents = lineSubtotalCents + lineTaxCents

    if (line.lineSubtotalCents !== undefined && line.lineSubtotalCents !== lineSubtotalCents) {
      throw Errors.mathMismatch('lineSubtotalCents', lineSubtotalCents, line.lineSubtotalCents)
    }
    if (line.lineTaxCents !== undefined && line.lineTaxCents !== lineTaxCents) {
      throw Errors.mathMismatch('lineTaxCents', lineTaxCents, line.lineTaxCents)
    }
    if (line.lineTotalCents !== undefined && line.lineTotalCents !== lineTotalCents) {
      throw Errors.mathMismatch('lineTotalCents', lineTotalCents, line.lineTotalCents)
    }

    subtotalCents += lineSubtotalCents
    taxCents += lineTaxCents

    return {
      quantityStr: (qtyMilli / 1000).toFixed(3),
      unitPriceCents: line.unitPriceCents,
      taxable,
      effectiveTaxRateBps,
      lineSubtotalCents,
      lineTaxCents,
      lineTotalCents
    }
  })

  const totalCents = subtotalCents + taxCents

  if (clientTotals?.subtotalCents !== undefined && clientTotals.subtotalCents !== subtotalCents) {
    throw Errors.mathMismatch('subtotalCents', subtotalCents, clientTotals.subtotalCents)
  }
  if (clientTotals?.taxCents !== undefined && clientTotals.taxCents !== taxCents) {
    throw Errors.mathMismatch('taxCents', taxCents, clientTotals.taxCents)
  }
  if (clientTotals?.totalCents !== undefined && clientTotals.totalCents !== totalCents) {
    throw Errors.mathMismatch('totalCents', totalCents, clientTotals.totalCents)
  }

  return {
    lines: computedLines,
    subtotalCents,
    taxCents,
    totalCents
  }
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(cents / 100)
}
