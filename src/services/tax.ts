import { resolveState, formatPlaceOfSupply, IndianState } from '../constants/gst.js';
import {
  fromPaise,
  percentOfPaise,
  round2,
  round3,
  roundOffToRupee,
  toNumber,
  toPaise
} from '../utils/money.js';

/**
 * The GST engine.
 *
 * One pure module computes every amount that lands on an invoice, credit note
 * or debit note, so the figures a user previews while typing are produced by
 * the same code that persists them. Nothing here touches the database.
 *
 * Two rules matter and are enforced structurally rather than by convention:
 *
 *  1. All arithmetic happens in integer paise. Line taxes are derived from the
 *     line's own taxable value, and document totals are the sum of already
 *     rounded line values - so the printed total always equals the sum of the
 *     printed lines.
 *  2. For an intra-state supply, SGST is computed as (total tax - CGST) rather
 *     than rounded independently. At an odd rate such as 5% on 101.01 the two
 *     halves would otherwise differ from the total by a paisa.
 */

export interface TaxLineInput {
  quantity: number;
  unitPrice: number;
  /** Percentage off this line, 0-100. */
  discountPercent?: number;
  /** Combined GST rate; split in half for CGST/SGST on an intra-state supply. */
  taxRate?: number;
}

export interface ComputedTaxLine {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  /** Gross line value before discount. */
  subtotal: number;
  /** Value GST is charged on. */
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  taxAmount: number;
  total: number;
}

export interface ComputedTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  extraCharges?: number;
  roundOff: number;
  grandTotal: number;
}

export interface DocumentTotals<T> extends ComputedTotals {
  lines: T[];
}

export interface SupplyContext {
  /** True when the supply crosses state lines and IGST applies. */
  isIgst: boolean;
  placeOfSupply: string | null;
  placeOfSupplyCode: string | null;
  sellerStateCode: string | null;
}

/**
 * Decides CGST+SGST vs IGST.
 *
 * An unknown or missing buyer state falls back to the seller's state, i.e. an
 * intra-state supply. That is the conservative default: it produces the same
 * total tax as IGST, so a later correction changes only the split, never the
 * amount the customer owes.
 */
export const resolveSupply = (
  sellerState?: string | null,
  buyerState?: string | null,
  explicitPlaceOfSupply?: string | null
): SupplyContext => {
  const seller = resolveState(sellerState);
  const buyer = resolveState(explicitPlaceOfSupply ?? buyerState) ?? seller;

  const placeOfSupply: IndianState | null = buyer;

  return {
    isIgst: Boolean(seller && placeOfSupply && seller.code !== placeOfSupply.code),
    placeOfSupply: placeOfSupply ? formatPlaceOfSupply(placeOfSupply) : null,
    placeOfSupplyCode: placeOfSupply?.code ?? null,
    sellerStateCode: seller?.code ?? null
  };
};

const clampPercent = (value: number | undefined, max: number): number => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, max);
};

/**
 * How the entered unit price relates to tax, and whether GST applies at all.
 * Both come from the business's settings and are threaded through every
 * calculation so a preview and a saved document can never disagree.
 */
export interface TaxMode {
  /** False when the business is not GST registered; every line is taxed at 0%. */
  gstEnabled?: boolean;
  /** True when entered prices already contain the tax. */
  pricesIncludeTax?: boolean;
}

/** Computes a single line. Exported for previews and unit-level reuse. */
export const computeLine = (
  input: TaxLineInput,
  isIgst: boolean,
  mode: TaxMode = {}
): ComputedTaxLine => {
  const { gstEnabled = true, pricesIncludeTax = false } = mode;

  const quantity = round3(Math.max(0, toNumber(input.quantity)));
  const enteredPrice = round2(Math.max(0, toNumber(input.unitPrice)));
  const discountPercent = clampPercent(input.discountPercent, 100);
  const taxRate = gstEnabled ? clampPercent(input.taxRate, 100) : 0;

  // Quantity carries 3dp, so multiply in paise and round once.
  const enteredGrossPaise = Math.round(toPaise(enteredPrice) * quantity);

  // In tax-inclusive mode the entered figure already contains the GST, so the
  // tax is backed out at the line level before anything else happens. Doing it
  // here - rather than adjusting the total at the end - keeps every downstream
  // invariant intact: subtotal - discount = taxable, and taxable + tax = total.
  const grossPaise =
    pricesIncludeTax && taxRate > 0
      ? Math.round(enteredGrossPaise / (1 + taxRate / 100))
      : enteredGrossPaise;

  // The rate column has to multiply out to the subtotal on the printed
  // document, so it shows the tax-exclusive rate once the tax is removed.
  const unitPrice =
    pricesIncludeTax && taxRate > 0 && quantity > 0
      ? round2(fromPaise(grossPaise) / quantity)
      : enteredPrice;

  const discountPaise = percentOfPaise(grossPaise, discountPercent);
  const taxablePaise = grossPaise - discountPaise;

  const taxPaise = percentOfPaise(taxablePaise, taxRate);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (isIgst) {
    igstPaise = taxPaise;
  } else {
    cgstPaise = percentOfPaise(taxablePaise, taxRate / 2);
    // Derived, not rounded independently, so the halves always add to the whole.
    sgstPaise = taxPaise - cgstPaise;
  }

  const halfRate = round2(taxRate / 2);

  return {
    quantity,
    unitPrice,
    discountPercent,
    discountAmount: fromPaise(discountPaise),
    taxRate,
    subtotal: fromPaise(grossPaise),
    taxableAmount: fromPaise(taxablePaise),
    cgstRate: isIgst ? 0 : halfRate,
    cgstAmount: fromPaise(cgstPaise),
    sgstRate: isIgst ? 0 : halfRate,
    sgstAmount: fromPaise(sgstPaise),
    igstRate: isIgst ? taxRate : 0,
    igstAmount: fromPaise(igstPaise),
    taxAmount: fromPaise(taxPaise),
    total: fromPaise(taxablePaise + taxPaise)
  };
};

/**
 * Computes every line plus the document totals.
 *
 * `enableRoundOff` nudges the grand total to the nearest rupee and records the
 * adjustment, which is what Indian invoices print as "Round Off".
 */
export const computeDocument = <T extends TaxLineInput>(
  lines: T[],
  options: { isIgst: boolean; enableRoundOff?: boolean; extraCharges?: number } & TaxMode
): DocumentTotals<T & ComputedTaxLine> => {
  const { isIgst, enableRoundOff = true, gstEnabled, pricesIncludeTax, extraCharges = 0 } = options;
  const extraPaise = toPaise(Math.max(0, extraCharges));

  const computed = lines.map((line) => ({
    ...line,
    ...computeLine(line, isIgst, { gstEnabled, pricesIncludeTax })
  }));

  // Totals sum the rounded line values, never the raw products.
  const totals = computed.reduce(
    (acc, line) => ({
      subtotal: acc.subtotal + toPaise(line.subtotal),
      discountAmount: acc.discountAmount + toPaise(line.discountAmount),
      taxableAmount: acc.taxableAmount + toPaise(line.taxableAmount),
      cgstAmount: acc.cgstAmount + toPaise(line.cgstAmount),
      sgstAmount: acc.sgstAmount + toPaise(line.sgstAmount),
      igstAmount: acc.igstAmount + toPaise(line.igstAmount),
      taxAmount: acc.taxAmount + toPaise(line.taxAmount)
    }),
    {
      subtotal: 0,
      discountAmount: 0,
      taxableAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxAmount: 0
    }
  );

  const beforeRoundOff = totals.taxableAmount + totals.taxAmount + extraPaise;
  const { total: roundedTotal, adjustment } = enableRoundOff
    ? roundOffToRupee(beforeRoundOff)
    : { total: beforeRoundOff, adjustment: 0 };

  return {
    lines: computed,
    subtotal: fromPaise(totals.subtotal),
    discountAmount: fromPaise(totals.discountAmount),
    taxableAmount: fromPaise(totals.taxableAmount),
    cgstAmount: fromPaise(totals.cgstAmount),
    sgstAmount: fromPaise(totals.sgstAmount),
    igstAmount: fromPaise(totals.igstAmount),
    taxAmount: fromPaise(totals.taxAmount),
    extraCharges: fromPaise(extraPaise),
    roundOff: fromPaise(adjustment),
    grandTotal: fromPaise(roundedTotal)
  };
};

/**
 * HSN/SAC summary required on a GST invoice and in the GSTR-1 style report.
 * Groups by code *and* rate, because the same code can be billed at two rates.
 */
export interface HsnSummaryRow {
  hsnSacCode: string;
  taxRate: number;
  quantity: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  total: number;
}

export const buildHsnSummary = (
  lines: Array<ComputedTaxLine & { hsnSacCode?: string | null }>
): HsnSummaryRow[] => {
  const groups = new Map<string, HsnSummaryRow>();

  for (const line of lines) {
    const code = line.hsnSacCode?.trim() || 'NA';
    const key = `${code}@${line.taxRate}`;

    const existing = groups.get(key);
    if (existing) {
      existing.quantity = round3(existing.quantity + line.quantity);
      existing.taxableAmount = round2(existing.taxableAmount + line.taxableAmount);
      existing.cgstAmount = round2(existing.cgstAmount + line.cgstAmount);
      existing.sgstAmount = round2(existing.sgstAmount + line.sgstAmount);
      existing.igstAmount = round2(existing.igstAmount + line.igstAmount);
      existing.taxAmount = round2(existing.taxAmount + line.taxAmount);
      existing.total = round2(existing.total + line.total);
      continue;
    }

    groups.set(key, {
      hsnSacCode: code,
      taxRate: line.taxRate,
      quantity: line.quantity,
      taxableAmount: line.taxableAmount,
      cgstAmount: line.cgstAmount,
      sgstAmount: line.sgstAmount,
      igstAmount: line.igstAmount,
      taxAmount: line.taxAmount,
      total: line.total
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.hsnSacCode.localeCompare(b.hsnSacCode) || a.taxRate - b.taxRate
  );
};

/**
 * Tax-rate breakdown shown under the totals block ("CGST 9%", "IGST 18%").
 * Only rates actually used appear, so a zero-rated invoice prints no GST rows.
 */
export interface TaxRateBreakdownRow {
  taxRate: number;
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  taxAmount: number;
}

export const buildTaxRateBreakdown = (lines: ComputedTaxLine[]): TaxRateBreakdownRow[] => {
  const groups = new Map<number, TaxRateBreakdownRow>();

  for (const line of lines) {
    const existing = groups.get(line.taxRate);
    if (existing) {
      existing.taxableAmount = round2(existing.taxableAmount + line.taxableAmount);
      existing.cgstAmount = round2(existing.cgstAmount + line.cgstAmount);
      existing.sgstAmount = round2(existing.sgstAmount + line.sgstAmount);
      existing.igstAmount = round2(existing.igstAmount + line.igstAmount);
      existing.taxAmount = round2(existing.taxAmount + line.taxAmount);
      continue;
    }

    groups.set(line.taxRate, {
      taxRate: line.taxRate,
      taxableAmount: line.taxableAmount,
      cgstRate: line.cgstRate,
      cgstAmount: line.cgstAmount,
      sgstRate: line.sgstRate,
      sgstAmount: line.sgstAmount,
      igstRate: line.igstRate,
      igstAmount: line.igstAmount,
      taxAmount: line.taxAmount
    });
  }

  return Array.from(groups.values())
    .filter((row) => row.taxableAmount !== 0 || row.taxAmount !== 0)
    .sort((a, b) => a.taxRate - b.taxRate);
};
