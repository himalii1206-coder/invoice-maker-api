import { Prisma, InvoiceStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { round2, toNumber } from '../utils/money.js';
import {
  startOfDay,
  endOfDay,
  financialYearOf,
  financialYearRange,
  monthLabel,
  MONTH_LABELS
} from '../utils/date.js';
import { COUNTED_STATUSES, OPEN_STATUSES } from './invoice.js';

/**
 * Sales and tax reporting.
 *
 * Every report answers the same question from a different angle - "where did
 * the money come from, and what tax does it carry" - so they share one scope
 * builder. Cancelled invoices are excluded everywhere: they are not revenue,
 * and including them would overstate both sales and the GST liability.
 *
 * Aggregation is pushed into the database rather than done in JS. A business
 * with years of history would otherwise have to load every invoice into memory
 * to draw a twelve-point chart.
 */

export interface ReportScope {
  financialYear?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  /** Drafts are excluded by default - they are not yet real sales. */
  includeDrafts?: boolean;
}

const REVENUE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID
];

/** Turns a report scope into the invoice filter every query shares. */
const buildScope = (companyId: string, scope: ReportScope): Prisma.InvoiceWhereInput => {
  const where: Prisma.InvoiceWhereInput = {
    companyId,
    status: { in: scope.includeDrafts ? COUNTED_STATUSES : REVENUE_STATUSES },
    ...(scope.customerId && { customerId: scope.customerId })
  };

  if (scope.dateFrom || scope.dateTo) {
    where.issueDate = {
      ...(scope.dateFrom && { gte: startOfDay(scope.dateFrom) }),
      ...(scope.dateTo && { lte: endOfDay(scope.dateTo) })
    };
  } else if (scope.financialYear) {
    where.financialYear = scope.financialYear;
  } else if (scope.year) {
    where.issueDate = {
      gte: new Date(Date.UTC(scope.year, 0, 1)),
      lte: new Date(Date.UTC(scope.year, 11, 31, 23, 59, 59, 999))
    };
  }

  return where;
};

/** Resolves the window a period report covers, defaulting to this financial year. */
const resolveRange = (scope: ReportScope): { from: Date; to: Date; label: string } => {
  if (scope.dateFrom || scope.dateTo) {
    const from = scope.dateFrom ? startOfDay(scope.dateFrom) : new Date(Date.UTC(1970, 0, 1));
    const to = scope.dateTo ? endOfDay(scope.dateTo) : endOfDay(new Date());
    return { from, to, label: 'Custom range' };
  }

  if (scope.year) {
    return {
      from: new Date(Date.UTC(scope.year, 0, 1)),
      to: new Date(Date.UTC(scope.year, 11, 31, 23, 59, 59, 999)),
      label: String(scope.year)
    };
  }

  const fy = scope.financialYear ?? financialYearOf();
  const range = financialYearRange(fy);
  return { ...range, label: `FY ${fy}` };
};

export interface PeriodPoint {
  key: string;
  label: string;
  invoiceCount: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}

export class ReportService {
  /**
   * Sales per month across a window.
   *
   * Months with no invoices are filled in with zeros so a chart shows a real
   * gap rather than silently compressing the axis.
   */
  static async monthlySales(companyId: string, scope: ReportScope = {}) {
    const { from, to, label } = resolveRange(scope);
    const where = { ...buildScope(companyId, scope), issueDate: { gte: from, lte: to } };

    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        issueDate: true,
        taxableAmount: true,
        taxAmount: true,
        grandTotal: true,
        amountPaid: true,
        balanceDue: true
      }
    });

    const buckets = new Map<string, PeriodPoint>();

    // Seed every month in the window, in order.
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

    while (cursor <= last) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const key = `${year}-${String(month).padStart(2, '0')}`;

      buckets.set(key, {
        key,
        label: monthLabel(year, month),
        invoiceCount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0
      });

      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    for (const invoice of invoices) {
      const date = new Date(invoice.issueDate);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.invoiceCount += 1;
      bucket.taxableAmount = round2(bucket.taxableAmount + toNumber(invoice.taxableAmount));
      bucket.taxAmount = round2(bucket.taxAmount + toNumber(invoice.taxAmount));
      bucket.totalAmount = round2(bucket.totalAmount + toNumber(invoice.grandTotal));
      bucket.paidAmount = round2(bucket.paidAmount + toNumber(invoice.amountPaid));
      bucket.outstandingAmount = round2(bucket.outstandingAmount + toNumber(invoice.balanceDue));
    }

    const series = Array.from(buckets.values());

    return {
      label,
      from,
      to,
      series,
      totals: this.sumPoints(series)
    };
  }

  /**
   * Sales per financial year.
   *
   * Grouping on the stored `financialYear` column rather than deriving it from
   * dates keeps this a single indexed aggregate.
   */
  static async yearlySales(companyId: string, scope: ReportScope = {}) {
    const where = buildScope(companyId, { ...scope, financialYear: undefined, year: undefined });

    const rows = await prisma.invoice.groupBy({
      by: ['financialYear'],
      where,
      orderBy: { financialYear: 'desc' },
      _count: true,
      _sum: {
        taxableAmount: true,
        taxAmount: true,
        grandTotal: true,
        amountPaid: true,
        balanceDue: true
      }
    });

    const series: PeriodPoint[] = rows
      .filter((row) => row.financialYear)
      .map((row) => ({
        key: row.financialYear,
        label: `FY ${row.financialYear}`,
        invoiceCount: row._count,
        taxableAmount: round2(row._sum?.taxableAmount ?? 0),
        taxAmount: round2(row._sum?.taxAmount ?? 0),
        totalAmount: round2(row._sum?.grandTotal ?? 0),
        paidAmount: round2(row._sum?.amountPaid ?? 0),
        outstandingAmount: round2(row._sum?.balanceDue ?? 0)
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return { series, totals: this.sumPoints(series) };
  }

  /** Revenue per customer, ranked by value - who actually matters. */
  static async customerSales(companyId: string, scope: ReportScope = {}, limit = 50) {
    const where = buildScope(companyId, scope);

    const rows = await prisma.invoice.groupBy({
      by: ['customerId'],
      where,
      orderBy: { _sum: { grandTotal: 'desc' } },
      take: limit,
      _count: true,
      _sum: {
        taxableAmount: true,
        taxAmount: true,
        grandTotal: true,
        amountPaid: true,
        balanceDue: true
      }
    });

    // One lookup for the names, rather than a join per group.
    const customers = await prisma.customer.findMany({
      where: { id: { in: rows.map((row) => row.customerId) } },
      select: { id: true, name: true, type: true, gstin: true, state: true, email: true }
    });

    const byId = new Map(customers.map((customer) => [customer.id, customer]));

    const series = rows.map((row) => {
      const customer = byId.get(row.customerId);

      return {
        customerId: row.customerId,
        name: customer?.name ?? 'Deleted customer',
        type: customer?.type ?? null,
        gstin: customer?.gstin ?? null,
        state: customer?.state ?? null,
        email: customer?.email ?? null,
        invoiceCount: row._count,
        taxableAmount: round2(row._sum?.taxableAmount ?? 0),
        taxAmount: round2(row._sum?.taxAmount ?? 0),
        totalAmount: round2(row._sum?.grandTotal ?? 0),
        paidAmount: round2(row._sum?.amountPaid ?? 0),
        outstandingAmount: round2(row._sum?.balanceDue ?? 0)
      };
    });

    return {
      series,
      totals: {
        customerCount: series.length,
        totalAmount: round2(series.reduce((sum, row) => sum + row.totalAmount, 0)),
        paidAmount: round2(series.reduce((sum, row) => sum + row.paidAmount, 0)),
        outstandingAmount: round2(series.reduce((sum, row) => sum + row.outstandingAmount, 0))
      }
    };
  }

  /**
   * Revenue per product.
   *
   * Grouped on the line item's own name rather than `productId`, so one-off
   * lines and items whose catalogue entry was later deleted still appear -
   * they were still sold.
   */
  static async productSales(companyId: string, scope: ReportScope = {}, limit = 50) {
    const invoiceWhere = buildScope(companyId, scope);

    const items = await prisma.invoiceItem.findMany({
      where: { invoice: invoiceWhere },
      select: {
        productId: true,
        name: true,
        hsnSacCode: true,
        unit: true,
        quantity: true,
        taxableAmount: true,
        taxAmount: true,
        total: true,
        taxRate: true
      }
    });

    interface ProductRow {
      productId: string | null;
      name: string;
      hsnSacCode: string | null;
      unit: string;
      lineCount: number;
      quantity: number;
      taxableAmount: number;
      taxAmount: number;
      totalAmount: number;
    }

    const groups = new Map<string, ProductRow>();

    for (const item of items) {
      // Key on the catalogue id when there is one, so a renamed product does
      // not split into two rows; fall back to the name for ad-hoc lines.
      const key = item.productId ?? `name:${item.name.trim().toLowerCase()}`;
      const existing = groups.get(key);

      if (existing) {
        existing.lineCount += 1;
        existing.quantity = round2(existing.quantity + toNumber(item.quantity));
        existing.taxableAmount = round2(existing.taxableAmount + toNumber(item.taxableAmount));
        existing.taxAmount = round2(existing.taxAmount + toNumber(item.taxAmount));
        existing.totalAmount = round2(existing.totalAmount + toNumber(item.total));
        continue;
      }

      groups.set(key, {
        productId: item.productId,
        name: item.name,
        hsnSacCode: item.hsnSacCode,
        unit: item.unit,
        lineCount: 1,
        quantity: toNumber(item.quantity),
        taxableAmount: toNumber(item.taxableAmount),
        taxAmount: toNumber(item.taxAmount),
        totalAmount: toNumber(item.total)
      });
    }

    const series = Array.from(groups.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, limit);

    return {
      series,
      totals: {
        productCount: groups.size,
        quantity: round2(series.reduce((sum, row) => sum + row.quantity, 0)),
        taxableAmount: round2(series.reduce((sum, row) => sum + row.taxableAmount, 0)),
        taxAmount: round2(series.reduce((sum, row) => sum + row.taxAmount, 0)),
        totalAmount: round2(series.reduce((sum, row) => sum + row.totalAmount, 0))
      }
    };
  }

  /**
   * GST summary in the shape a return needs: output tax split by rate and by
   * HSN/SAC, plus the CGST/SGST vs IGST totals.
   */
  static async gstSummary(companyId: string, scope: ReportScope = {}) {
    const invoiceWhere = buildScope(companyId, scope);

    const [items, invoiceTotals, noteTotals] = await Promise.all([
      prisma.invoiceItem.findMany({
        where: { invoice: invoiceWhere },
        select: {
          hsnSacCode: true,
          taxRate: true,
          quantity: true,
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxAmount: true,
          total: true
        }
      }),
      prisma.invoice.aggregate({
        where: invoiceWhere,
        _count: true,
        _sum: {
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxAmount: true,
          grandTotal: true
        }
      }),
      // Credit notes reduce output tax; debit notes add to it.
      prisma.creditDebitNote.groupBy({
        by: ['noteType'],
        where: {
          companyId,
          status: 'ISSUED',
          ...(scope.financialYear && { financialYear: scope.financialYear })
        },
        orderBy: { noteType: 'asc' },
        _count: true,
        _sum: {
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxAmount: true,
          grandTotal: true
        }
      })
    ]);

    interface RateRow {
      taxRate: number;
      taxableAmount: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      taxAmount: number;
    }

    interface HsnRow extends RateRow {
      hsnSacCode: string;
      quantity: number;
      totalAmount: number;
    }

    const byRate = new Map<number, RateRow>();
    const byHsn = new Map<string, HsnRow>();

    for (const item of items) {
      const rate = toNumber(item.taxRate);
      const code = item.hsnSacCode?.trim() || 'Unclassified';

      const rateRow = byRate.get(rate) ?? {
        taxRate: rate,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        taxAmount: 0
      };

      rateRow.taxableAmount = round2(rateRow.taxableAmount + toNumber(item.taxableAmount));
      rateRow.cgstAmount = round2(rateRow.cgstAmount + toNumber(item.cgstAmount));
      rateRow.sgstAmount = round2(rateRow.sgstAmount + toNumber(item.sgstAmount));
      rateRow.igstAmount = round2(rateRow.igstAmount + toNumber(item.igstAmount));
      rateRow.taxAmount = round2(rateRow.taxAmount + toNumber(item.taxAmount));
      byRate.set(rate, rateRow);

      // The same code can be billed at more than one rate, so the HSN table is
      // keyed by both - exactly how a GST return expects it.
      const hsnKey = `${code}@${rate}`;
      const hsnRow = byHsn.get(hsnKey) ?? {
        hsnSacCode: code,
        taxRate: rate,
        quantity: 0,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        taxAmount: 0,
        totalAmount: 0
      };

      hsnRow.quantity = round2(hsnRow.quantity + toNumber(item.quantity));
      hsnRow.taxableAmount = round2(hsnRow.taxableAmount + toNumber(item.taxableAmount));
      hsnRow.cgstAmount = round2(hsnRow.cgstAmount + toNumber(item.cgstAmount));
      hsnRow.sgstAmount = round2(hsnRow.sgstAmount + toNumber(item.sgstAmount));
      hsnRow.igstAmount = round2(hsnRow.igstAmount + toNumber(item.igstAmount));
      hsnRow.taxAmount = round2(hsnRow.taxAmount + toNumber(item.taxAmount));
      hsnRow.totalAmount = round2(hsnRow.totalAmount + toNumber(item.total));
      byHsn.set(hsnKey, hsnRow);
    }

    const credit = noteTotals.find((row) => row.noteType === 'CREDIT');
    const debit = noteTotals.find((row) => row.noteType === 'DEBIT');

    const outputTax = round2(invoiceTotals._sum?.taxAmount ?? 0);
    const creditTax = round2(credit?._sum?.taxAmount ?? 0);
    const debitTax = round2(debit?._sum?.taxAmount ?? 0);

    return {
      invoiceCount: invoiceTotals._count,
      taxableAmount: round2(invoiceTotals._sum?.taxableAmount ?? 0),
      cgstAmount: round2(invoiceTotals._sum?.cgstAmount ?? 0),
      sgstAmount: round2(invoiceTotals._sum?.sgstAmount ?? 0),
      igstAmount: round2(invoiceTotals._sum?.igstAmount ?? 0),
      taxAmount: outputTax,
      totalAmount: round2(invoiceTotals._sum?.grandTotal ?? 0),
      creditNotes: {
        count: credit?._count ?? 0,
        taxableAmount: round2(credit?._sum?.taxableAmount ?? 0),
        taxAmount: creditTax,
        totalAmount: round2(credit?._sum?.grandTotal ?? 0)
      },
      debitNotes: {
        count: debit?._count ?? 0,
        taxableAmount: round2(debit?._sum?.taxableAmount ?? 0),
        taxAmount: debitTax,
        totalAmount: round2(debit?._sum?.grandTotal ?? 0)
      },
      /** What is actually payable after notes are applied. */
      netTaxPayable: round2(outputTax + debitTax - creditTax),
      byRate: Array.from(byRate.values()).sort((a, b) => a.taxRate - b.taxRate),
      byHsn: Array.from(byHsn.values()).sort(
        (a, b) => b.taxableAmount - a.taxableAmount || a.hsnSacCode.localeCompare(b.hsnSacCode)
      )
    };
  }

  /**
   * Outstanding receivables bucketed by how late they are - the view that
   * decides who gets chased first.
   */
  static async agingReport(companyId: string, scope: ReportScope = {}) {
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: OPEN_STATUSES },
        balanceDue: { gt: 0 },
        ...(scope.customerId && { customerId: scope.customerId })
      },
      select: {
        id: true,
        invoiceNumber: true,
        billingName: true,
        customerId: true,
        issueDate: true,
        dueDate: true,
        grandTotal: true,
        balanceDue: true,
        status: true
      },
      orderBy: { dueDate: 'asc' }
    });

    const buckets = [
      { key: 'current', label: 'Not yet due', min: -Infinity, max: 0 },
      { key: '1-30', label: '1-30 days', min: 1, max: 30 },
      { key: '31-60', label: '31-60 days', min: 31, max: 60 },
      { key: '61-90', label: '61-90 days', min: 61, max: 90 },
      { key: '90+', label: 'Over 90 days', min: 91, max: Infinity }
    ].map((bucket) => ({ ...bucket, count: 0, amount: 0 }));

    const now = startOfDay(new Date()).getTime();

    const rows = invoices.map((invoice) => {
      const overdueDays = Math.round((now - startOfDay(invoice.dueDate).getTime()) / 86400000);
      const balance = toNumber(invoice.balanceDue);

      const bucket = buckets.find((b) => overdueDays >= b.min && overdueDays <= b.max);
      if (bucket) {
        bucket.count += 1;
        bucket.amount = round2(bucket.amount + balance);
      }

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        billingName: invoice.billingName,
        customerId: invoice.customerId,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        grandTotal: toNumber(invoice.grandTotal),
        balanceDue: balance,
        overdueDays: Math.max(0, overdueDays),
        bucket: bucket?.key ?? 'current'
      };
    });

    return {
      buckets,
      invoices: rows,
      totalOutstanding: round2(rows.reduce((sum, row) => sum + row.balanceDue, 0))
    };
  }

  /** Month labels for the current financial year, used to seed empty charts. */
  static financialYearMonths(financialYear?: string): string[] {
    const fy = financialYear ?? financialYearOf();
    const startYear = Number.parseInt(fy.slice(0, 4), 10);

    return Array.from({ length: 12 }, (_, index) => {
      const month = (3 + index) % 12;
      const year = startYear + (3 + index >= 12 ? 1 : 0);
      return `${MONTH_LABELS[month]} ${year}`;
    });
  }

  private static sumPoints(series: PeriodPoint[]) {
    return series.reduce(
      (acc, point) => ({
        invoiceCount: acc.invoiceCount + point.invoiceCount,
        taxableAmount: round2(acc.taxableAmount + point.taxableAmount),
        taxAmount: round2(acc.taxAmount + point.taxAmount),
        totalAmount: round2(acc.totalAmount + point.totalAmount),
        paidAmount: round2(acc.paidAmount + point.paidAmount),
        outstandingAmount: round2(acc.outstandingAmount + point.outstandingAmount)
      }),
      {
        invoiceCount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0
      }
    );
  }
}
