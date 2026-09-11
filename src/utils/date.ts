/**
 * Date helpers.
 *
 * Invoices are dated, not timestamped: two invoices raised on the same day must
 * compare equal regardless of the hour, and "overdue" must flip at midnight
 * rather than 24 hours after the due timestamp. Everything here normalises to
 * UTC midnight so the same comparison holds no matter where the server runs.
 */

/** Strips the time component, keeping the calendar day. */
export const startOfDay = (value: Date | string = new Date()): Date => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
};

export const endOfDay = (value: Date | string = new Date()): Date => {
  const date = new Date(value);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
};

export const today = (): Date => startOfDay(new Date());

export const addDays = (value: Date | string, days: number): Date => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

export const addMonths = (value: Date | string, months: number): Date => {
  const date = new Date(value);
  const targetDay = date.getUTCDate();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  // Clamp so 31 Jan + 1 month lands on the last day of February, not 3 March.
  const lastDayOfTarget = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();

  date.setUTCDate(Math.min(targetDay, lastDayOfTarget));
  return date;
};

/** Whole days between two calendar dates; positive when `to` is later. */
export const daysBetween = (from: Date | string, to: Date | string): number => {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / 86400000);
};

/**
 * Indian financial year for a date: 1 April to 31 March.
 * 15 Sep 2026 -> "2026-27", 15 Feb 2027 -> "2026-27".
 */
export const financialYearOf = (value: Date | string = new Date()): string => {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0 = January, 3 = April

  const startYear = month >= 3 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');

  return `${startYear}-${endShort}`;
};

/** Inclusive date range covering a financial year label such as "2026-27". */
export const financialYearRange = (label: string): { from: Date; to: Date } => {
  const startYear = Number.parseInt(label.slice(0, 4), 10);
  const safeStart = Number.isFinite(startYear) ? startYear : new Date().getUTCFullYear();

  return {
    from: new Date(Date.UTC(safeStart, 3, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(safeStart + 1, 2, 31, 23, 59, 59, 999))
  };
};

/** Financial years to offer in a year filter, newest first. */
export const financialYearOptions = (count = 6): string[] => {
  const current = financialYearOf();
  const startYear = Number.parseInt(current.slice(0, 4), 10);

  return Array.from({ length: count }, (_, index) => {
    const year = startYear - index;
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  });
};

export const monthRange = (year: number, month: number): { from: Date; to: Date } => ({
  from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
  to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
});

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** "Sep 2026" - used in report series labels. */
export const monthLabel = (year: number, month: number): string =>
  `${MONTH_LABELS[month - 1] ?? ''} ${year}`;

/** Stable "YYYY-MM" key for grouping. */
export const monthKey = (value: Date | string): string => {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** 15 Sep 2026 - the format used on printed documents and in emails. */
export const formatDocumentDate = (value: Date | string | null | undefined): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return `${String(date.getUTCDate()).padStart(2, '0')} ${
    MONTH_LABELS[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
};
