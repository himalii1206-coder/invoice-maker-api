import { Prisma } from '@prisma/client';

/**
 * Money helpers.
 *
 * Every amount in this module is computed in integer paise and only converted
 * back to rupees at the boundary. Doing the arithmetic in floats lets errors
 * like 0.1 + 0.2 leak into a tax total, which then fails to reconcile against
 * the sum of its own lines - the one thing an invoice must never do.
 */

/** Prisma serialises Decimal columns as strings, so numeric input arrives as text. */
export type Decimalish = Prisma.Decimal | string | number | null | undefined;

export const toNumber = (value: Decimalish): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Rupees -> paise. Rounds half away from zero, matching how invoices print. */
export const toPaise = (value: Decimalish): number => {
  const amount = toNumber(value);
  return Math.round(Math.abs(amount) * 100) * Math.sign(amount);
};

/** Paise -> rupees with exactly two decimals. */
export const fromPaise = (paise: number): number => Math.round(paise) / 100;

/** Rounds a rupee amount to 2dp without float drift. */
export const round2 = (value: Decimalish): number => fromPaise(toPaise(value));

/** Rounds a quantity to 3dp, the precision the quantity column stores. */
export const round3 = (value: Decimalish): number => {
  const amount = toNumber(value);
  return (Math.round(Math.abs(amount) * 1000) * Math.sign(amount)) / 1000;
};

/**
 * Applies a percentage to a paise amount and returns paise.
 * Kept separate so percentage maths never round-trips through rupees.
 */
export const percentOfPaise = (paise: number, percent: number): number =>
  Math.round((paise * percent) / 100);

/** Nearest-rupee round off used on the invoice grand total. */
export const roundOffToRupee = (paise: number): { total: number; adjustment: number } => {
  const total = Math.round(paise / 100) * 100;
  return { total, adjustment: total - paise };
};

export const sum = (values: number[]): number => values.reduce((acc, value) => acc + value, 0);

/**
 * Indian-format amount in words, used on the printed document.
 * Handles up to 99,99,99,999.99 which covers anything this product will invoice.
 */
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety'
];

const twoDigitsToWords = (value: number): string => {
  if (value < 20) return ONES[value] ?? '';
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`;
};

const threeDigitsToWords = (value: number): string => {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(' ');
};

/** Groups an integer the Indian way: crore, lakh, thousand, hundred. */
const integerToIndianWords = (value: number): string => {
  if (value === 0) return 'Zero';

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${twoDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitsToWords(rest));

  return parts.join(' ');
};

export const amountInWords = (amount: Decimalish, currency = 'INR'): string => {
  const paise = Math.abs(toPaise(amount));
  const rupees = Math.floor(paise / 100);
  const fraction = paise % 100;

  const unit = currency === 'INR' ? 'Rupees' : currency;
  const subUnit = currency === 'INR' ? 'Paise' : 'Cents';

  const head = `${unit} ${integerToIndianWords(rupees)}`;
  const tail = fraction ? ` and ${subUnit} ${twoDigitsToWords(fraction)}` : '';

  return `${toNumber(amount) < 0 ? 'Minus ' : ''}${head}${tail} Only`;
};

/** Formats for emails and PDFs, where Intl output is more predictable than a locale guess. */
export const formatMoney = (amount: Decimalish, currency = 'INR'): string => {
  const value = round2(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value));

  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${value < 0 ? '-' : ''}${symbol}${formatted}`;
};
