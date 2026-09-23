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
import { decryptField, decryptObject } from '../utils/encryption.js';

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

    const decryptedCustomers = customers.map((c) => decryptObject(c, ['gstin']));
    const byId = new Map(decryptedCustomers.map((customer) => [customer.id, customer]));

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

  /**
   * Comprehensive analytics encompassing all 7 dimensions requested:
   * 1. Sales Analytics (by day, week, month, year, growth %, status, customer, product, company)
   * 2. Invoice Analytics (total, paid, unpaid, overdue, cancelled, draft, average turnaround)
   * 3. Payment Analytics (total received, pending, overdue, method breakdown, collection trends)
   * 4. GST / Tax Analytics (total taxable, CGST, SGST, IGST, total GST, monthly, tax-rate slabs, HSN)
   * 5. Customer Analytics (total, new, repeat, top customers, outstanding, payment history)
   * 6. Product / Service Analytics (top-selling, revenue, quantity, tax generated, invoice count)
   * 7. Receivables Analytics (aging buckets, overdue list)
   */
  static async comprehensiveAnalytics(companyId: string, scope: ReportScope = {}) {
    const { from, to, label } = resolveRange(scope);
    const invoiceWhere = buildScope(companyId, scope);

    const [
      rawCompany,
      rawInvoices,
      allPayments,
      rawCustomers,
      invoiceItems,
      purchaseBills
    ] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, gstin: true, state: true }
      }),
      prisma.invoice.findMany({
        where: {
          companyId,
          ...(scope.financialYear ? { financialYear: scope.financialYear } : {})
        },
        include: {
          customer: {
            select: { id: true, name: true, gstin: true, phone: true, email: true, state: true }
          },
          payments: {
            select: { id: true, amount: true, paymentDate: true, paymentMethod: true, referenceNumber: true }
          }
        },
        orderBy: { issueDate: 'desc' }
      }),
      prisma.payment.findMany({
        where: {
          companyId,
          ...(scope.dateFrom || scope.dateTo
            ? {
                paymentDate: {
                  ...(scope.dateFrom && { gte: startOfDay(scope.dateFrom) }),
                  ...(scope.dateTo && { lte: endOfDay(scope.dateTo) })
                }
              }
            : {})
        },
        include: {
          invoice: {
            select: { id: true, invoiceNumber: true, billingName: true, customerId: true }
          }
        },
        orderBy: { paymentDate: 'desc' }
      }),
      prisma.customer.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true,
          type: true,
          gstin: true,
          email: true,
          phone: true,
          state: true,
          city: true,
          createdAt: true
        }
      }),
      prisma.invoiceItem.findMany({
        where: {
          invoice: invoiceWhere
        },
        select: {
          id: true,
          name: true,
          productId: true,
          hsnSacCode: true,
          unit: true,
          quantity: true,
          unitPrice: true,
          taxRate: true,
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxAmount: true,
          total: true
        }
      }),
      prisma.purchaseBill.findMany({
        where: {
          companyId,
          status: { not: 'CANCELLED' },
          ...(scope.financialYear ? { financialYear: scope.financialYear } : {})
        },
        select: {
          id: true,
          billNumber: true,
          vendorName: true,
          billDate: true,
          dueDate: true,
          grandTotal: true,
          amountPaid: true,
          balanceDue: true,
          taxAmount: true,
          status: true
        }
      })
    ]);

    const company = rawCompany ? decryptObject(rawCompany, ['gstin']) : null;
    const allCustomers = rawCustomers.map((c) => decryptObject(c, ['gstin']));
    const allInvoices = rawInvoices.map((inv) => ({
      ...inv,
      customer: inv.customer ? decryptObject(inv.customer, ['gstin']) : null
    }));

    const now = startOfDay(new Date()).getTime();

    // ----------------------------------------------------
    // 1. INVOICE ANALYTICS & COUNTS
    // ----------------------------------------------------
    let totalInvoicedAmount = 0;
    let totalPaidAmount = 0;
    let totalDueAmount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let cancelledCount = 0;
    let draftCount = 0;
    let totalPaymentTurnaroundDays = 0;
    let settledWithTurnaroundCount = 0;

    const statusBreakdownMap: Record<string, { count: number; amount: number }> = {
      PAID: { count: 0, amount: 0 },
      PARTIALLY_PAID: { count: 0, amount: 0 },
      SENT: { count: 0, amount: 0 },
      OVERDUE: { count: 0, amount: 0 },
      DRAFT: { count: 0, amount: 0 },
      CANCELLED: { count: 0, amount: 0 }
    };

    for (const inv of allInvoices) {
      const gTotal = toNumber(inv.grandTotal);
      const aPaid = toNumber(inv.amountPaid);
      const bDue = toNumber(inv.balanceDue);
      const st = inv.status;

      if (!statusBreakdownMap[st]) {
        statusBreakdownMap[st] = { count: 0, amount: 0 };
      }
      statusBreakdownMap[st].count += 1;
      statusBreakdownMap[st].amount = round2(statusBreakdownMap[st].amount + gTotal);

      if (st === InvoiceStatus.CANCELLED) {
        cancelledCount += 1;
        continue; // Exclude cancelled from active revenue sums
      }

      if (st === InvoiceStatus.DRAFT) {
        draftCount += 1;
      } else {
        totalInvoicedAmount = round2(totalInvoicedAmount + gTotal);
        totalPaidAmount = round2(totalPaidAmount + aPaid);
        totalDueAmount = round2(totalDueAmount + bDue);

        if (st === InvoiceStatus.PAID) {
          paidCount += 1;
          // Calculate turnaround days to pay
          if (inv.payments.length > 0) {
            const lastPaymentDate = new Date(
              Math.max(...inv.payments.map((p) => new Date(p.paymentDate).getTime()))
            );
            const issueD = new Date(inv.issueDate);
            const days = Math.max(0, Math.round((lastPaymentDate.getTime() - issueD.getTime()) / 86400000));
            totalPaymentTurnaroundDays += days;
            settledWithTurnaroundCount += 1;
          }
        } else if (st === InvoiceStatus.OVERDUE) {
          overdueCount += 1;
          unpaidCount += 1;
        } else {
          unpaidCount += 1;
        }
      }
    }

    const averagePaymentDays = settledWithTurnaroundCount > 0
      ? Math.round(totalPaymentTurnaroundDays / settledWithTurnaroundCount)
      : 0;

    const invoiceAnalytics = {
      totalInvoices: allInvoices.length,
      paidInvoices: paidCount,
      unpaidInvoices: unpaidCount,
      overdueInvoices: overdueCount,
      cancelledInvoices: cancelledCount,
      draftInvoices: draftCount,
      totalInvoicedAmount,
      totalPaidAmount,
      totalDueAmount,
      averagePaymentDays,
      collectionEfficiency: totalInvoicedAmount > 0 ? Math.round((totalPaidAmount / totalInvoicedAmount) * 100) : 0
    };

    // ----------------------------------------------------
    // 2. SALES ANALYTICS (Day, Week, Month, Year, Growth %, Status, Customer, Product, Company)
    // ----------------------------------------------------
    // Daily trends (last 14 days)
    const dailyMap = new Map<string, { label: string; invoiced: number; paid: number; count: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyMap.set(key, {
        label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        invoiced: 0,
        paid: 0,
        count: 0
      });
    }

    // Monthly trends (12 months)
    const monthlyMap = new Map<string, { month: string; invoiced: number; paid: number; count: number; tax: number }>();
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const lastMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

    while (cursor <= lastMonth) {
      const yr = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth() + 1;
      const key = `${yr}-${String(m).padStart(2, '0')}`;
      monthlyMap.set(key, {
        month: monthLabel(yr, m),
        invoiced: 0,
        paid: 0,
        count: 0,
        tax: 0
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // Weekly map (last 8 weeks)
    const weeklyMap = new Map<string, { label: string; invoiced: number; paid: number; count: number }>();
    for (let w = 7; w >= 0; w--) {
      const wDate = new Date();
      wDate.setDate(wDate.getDate() - w * 7);
      const weekKey = `W-${wDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
      weeklyMap.set(weekKey, {
        label: weekKey,
        invoiced: 0,
        paid: 0,
        count: 0
      });
    }

    for (const inv of allInvoices) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;
      const dStr = new Date(inv.issueDate).toISOString().split('T')[0];
      const mKey = `${new Date(inv.issueDate).getUTCFullYear()}-${String(new Date(inv.issueDate).getUTCMonth() + 1).padStart(2, '0')}`;
      const gTotal = toNumber(inv.grandTotal);
      const aPaid = toNumber(inv.amountPaid);
      const tTax = toNumber(inv.taxAmount);

      if (dailyMap.has(dStr)) {
        const dObj = dailyMap.get(dStr)!;
        dObj.invoiced = round2(dObj.invoiced + gTotal);
        dObj.paid = round2(dObj.paid + aPaid);
        dObj.count += 1;
      }

      if (monthlyMap.has(mKey)) {
        const mObj = monthlyMap.get(mKey)!;
        mObj.invoiced = round2(mObj.invoiced + gTotal);
        mObj.paid = round2(mObj.paid + aPaid);
        mObj.count += 1;
        mObj.tax = round2(mObj.tax + tTax);
      }
    }

    const monthlyTrends = Array.from(monthlyMap.values());
    const dailyTrends = Array.from(dailyMap.values());
    const weeklyTrends = Array.from(weeklyMap.values());

    // Growth % calculation (Comparing latest month with prior month)
    let salesGrowthPercent = 0;
    if (monthlyTrends.length >= 2) {
      const currentMonthSales = monthlyTrends[monthlyTrends.length - 1]?.invoiced || 0;
      const priorMonthSales = monthlyTrends[monthlyTrends.length - 2]?.invoiced || 0;
      if (priorMonthSales > 0) {
        salesGrowthPercent = round2(((currentMonthSales - priorMonthSales) / priorMonthSales) * 100);
      } else if (currentMonthSales > 0) {
        salesGrowthPercent = 100;
      }
    }

    // Status breakdown array
    const salesByStatus = Object.entries(statusBreakdownMap).map(([status, val]) => ({
      status,
      count: val.count,
      amount: val.amount,
      percentage: totalInvoicedAmount > 0 ? Math.round((val.amount / totalInvoicedAmount) * 100) : 0
    }));

    // Customer sales ranking
    const custSalesMap = new Map<string, { customerId: string; name: string; gstin: string | null; invoiced: number; paid: number; outstanding: number; count: number }>();
    for (const inv of allInvoices) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;
      const cId = inv.customerId || 'direct-cash';
      const cName = inv.customer?.name || inv.billingName || 'Cash / Direct Sale';
      const cGstin = inv.customer?.gstin || null;

      const existing = custSalesMap.get(cId) ?? {
        customerId: cId,
        name: cName,
        gstin: cGstin,
        invoiced: 0,
        paid: 0,
        outstanding: 0,
        count: 0
      };

      existing.invoiced = round2(existing.invoiced + toNumber(inv.grandTotal));
      existing.paid = round2(existing.paid + toNumber(inv.amountPaid));
      existing.outstanding = round2(existing.outstanding + toNumber(inv.balanceDue));
      existing.count += 1;
      custSalesMap.set(cId, existing);
    }

    const salesByCustomer = Array.from(custSalesMap.values())
      .sort((a, b) => b.invoiced - a.invoiced)
      .slice(0, 10);

    const salesAnalytics = {
      byDay: dailyTrends,
      byWeek: weeklyTrends,
      byMonth: monthlyTrends,
      growthRatePercent: salesGrowthPercent,
      byStatus: salesByStatus,
      byCustomer: salesByCustomer,
      companyOverview: {
        name: company?.name ?? 'Business',
        gstin: company?.gstin ?? 'Unregistered',
        currency: 'INR',
        state: company?.state ?? 'Gujarat',
        totalTurnover: totalInvoicedAmount
      }
    };

    // ----------------------------------------------------
    // 3. PAYMENT ANALYTICS
    // ----------------------------------------------------
    const paymentMethodMap: Record<string, { count: number; amount: number }> = {
      BANK_TRANSFER: { count: 0, amount: 0 },
      UPI: { count: 0, amount: 0 },
      CASH: { count: 0, amount: 0 },
      CARD: { count: 0, amount: 0 },
      CHEQUE: { count: 0, amount: 0 },
      OTHER: { count: 0, amount: 0 }
    };

    let totalReceived = 0;
    for (const p of allPayments) {
      const amt = toNumber(p.amount);
      totalReceived = round2(totalReceived + amt);
      const m = p.paymentMethod || 'OTHER';
      if (!paymentMethodMap[m]) {
        paymentMethodMap[m] = { count: 0, amount: 0 };
      }
      paymentMethodMap[m].count += 1;
      paymentMethodMap[m].amount = round2(paymentMethodMap[m].amount + amt);
    }

    const byPaymentMethod = Object.entries(paymentMethodMap).map(([method, data]) => ({
      method,
      label: method.replace(/_/g, ' '),
      amount: data.amount,
      count: data.count,
      percentage: totalReceived > 0 ? Math.round((data.amount / totalReceived) * 100) : 0
    }));

    const paymentAnalytics = {
      totalReceived,
      pendingPayments: totalDueAmount,
      overduePayments: round2(
        allInvoices
          .filter((i) => i.status === InvoiceStatus.OVERDUE || (toNumber(i.balanceDue) > 0 && new Date(i.dueDate).getTime() < now))
          .reduce((sum, i) => sum + toNumber(i.balanceDue), 0)
      ),
      byMethod: byPaymentMethod,
      monthlyCollectionTrend: monthlyTrends.map((t) => ({ month: t.month, collected: t.paid }))
    };

    // ----------------------------------------------------
    // 4. GST & TAX ANALYTICS
    // ----------------------------------------------------
    let totalTaxableAmount = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalGstCollected = 0;

    const rateMap = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number }>();
    [0, 5, 12, 18, 28].forEach((r) => {
      rateMap.set(r, { rate: r, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 });
    });

    const hsnMap = new Map<string, { hsn: string; rate: number; quantity: number; taxable: number; tax: number; total: number }>();

    for (const item of invoiceItems) {
      const taxable = toNumber(item.taxableAmount);
      const cgst = toNumber(item.cgstAmount);
      const sgst = toNumber(item.sgstAmount);
      const igst = toNumber(item.igstAmount);
      const tax = toNumber(item.taxAmount);
      const rate = toNumber(item.taxRate);
      const hsn = item.hsnSacCode?.trim() || 'General';

      totalTaxableAmount = round2(totalTaxableAmount + taxable);
      totalCgst = round2(totalCgst + cgst);
      totalSgst = round2(totalSgst + sgst);
      totalIgst = round2(totalIgst + igst);
      totalGstCollected = round2(totalGstCollected + tax);

      // Rate map
      const rObj = rateMap.get(rate) ?? { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
      rObj.taxable = round2(rObj.taxable + taxable);
      rObj.cgst = round2(rObj.cgst + cgst);
      rObj.sgst = round2(rObj.sgst + sgst);
      rObj.igst = round2(rObj.igst + igst);
      rObj.tax = round2(rObj.tax + tax);
      rateMap.set(rate, rObj);

      // HSN map
      const hsnKey = `${hsn}@${rate}`;
      const hObj = hsnMap.get(hsnKey) ?? { hsn, rate, quantity: 0, taxable: 0, tax: 0, total: 0 };
      hObj.quantity = round2(hObj.quantity + toNumber(item.quantity));
      hObj.taxable = round2(hObj.taxable + taxable);
      hObj.tax = round2(hObj.tax + tax);
      hObj.total = round2(hObj.total + toNumber(item.total));
      hsnMap.set(hsnKey, hObj);
    }

    const gstAnalytics = {
      totalTaxableAmount,
      cgst: totalCgst,
      sgst: totalSgst,
      igst: totalIgst,
      totalGstCollected,
      gstByMonth: monthlyTrends.map((t) => ({ month: t.month, tax: t.tax })),
      taxRateBreakdown: Array.from(rateMap.values()).sort((a, b) => a.rate - b.rate),
      hsnBreakdown: Array.from(hsnMap.values()).sort((a, b) => b.taxable - a.taxable).slice(0, 15),
      inwardItcAvailable: round2(purchaseBills.reduce((acc, pb) => acc + toNumber(pb.taxAmount), 0)),
      netGstPayable: round2(
        Math.max(0, totalGstCollected - purchaseBills.reduce((acc, pb) => acc + toNumber(pb.taxAmount), 0))
      )
    };

    // ----------------------------------------------------
    // 5. CUSTOMER ANALYTICS
    // ----------------------------------------------------
    const customerInvoiceCountMap = new Map<string, number>();
    for (const inv of allInvoices) {
      if (inv.customerId) {
        customerInvoiceCountMap.set(inv.customerId, (customerInvoiceCountMap.get(inv.customerId) || 0) + 1);
      }
    }

    let newCustomerCount = 0;
    let repeatCustomerCount = 0;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    for (const c of allCustomers) {
      const count = customerInvoiceCountMap.get(c.id) || 0;
      if (count > 1) {
        repeatCustomerCount += 1;
      }
      if (new Date(c.createdAt) >= sixMonthsAgo) {
        newCustomerCount += 1;
      }
    }

    const customerAnalytics = {
      totalCustomers: allCustomers.length,
      newCustomers: newCustomerCount,
      repeatCustomers: repeatCustomerCount,
      topCustomersByRevenue: salesByCustomer,
      customerOutstanding: Array.from(custSalesMap.values())
        .filter((c) => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding),
      customerPaymentHistory: allPayments.slice(0, 10).map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        date: p.paymentDate,
        method: p.paymentMethod,
        invoiceNumber: p.invoice?.invoiceNumber,
        customerName: p.invoice?.billingName
      }))
    };

    // ----------------------------------------------------
    // 6. PRODUCT / SERVICE ANALYTICS
    // ----------------------------------------------------
    const prodMap = new Map<string, { name: string; quantity: number; revenue: number; tax: number; invoiceCount: number; unit: string }>();

    for (const it of invoiceItems) {
      const key = it.productId || it.name.trim().toLowerCase();
      const existing = prodMap.get(key) ?? {
        name: it.name,
        quantity: 0,
        revenue: 0,
        tax: 0,
        invoiceCount: 0,
        unit: it.unit || 'PCS'
      };

      existing.quantity = round2(existing.quantity + toNumber(it.quantity));
      existing.revenue = round2(existing.revenue + toNumber(it.total));
      existing.tax = round2(existing.tax + toNumber(it.taxAmount));
      existing.invoiceCount += 1;
      prodMap.set(key, existing);
    }

    const productList = Array.from(prodMap.values()).sort((a, b) => b.revenue - a.revenue);
    const productAnalytics = {
      topSelling: productList.slice(0, 10),
      totalQuantitySold: round2(productList.reduce((sum, p) => sum + p.quantity, 0)),
      totalProductRevenue: round2(productList.reduce((sum, p) => sum + p.revenue, 0)),
      totalTaxGenerated: round2(productList.reduce((sum, p) => sum + p.tax, 0)),
      totalProductCount: productList.length
    };

    // ----------------------------------------------------
    // 7. RECEIVABLES & AGING ANALYTICS
    // ----------------------------------------------------
    const agingBuckets = {
      current: { label: 'Not Yet Due (Current)', amount: 0, count: 0 },
      overdue1_30: { label: '1 - 30 Days Overdue', amount: 0, count: 0 },
      overdue31_60: { label: '31 - 60 Days Overdue', amount: 0, count: 0 },
      overdue61_90: { label: '61 - 90 Days Overdue', amount: 0, count: 0 },
      overdue90Plus: { label: 'Over 90 Days Overdue', amount: 0, count: 0 }
    };

    const agingList: Array<{
      id: string;
      invoiceNumber: string;
      customerName: string;
      issueDate: Date;
      dueDate: Date;
      grandTotal: number;
      balanceDue: number;
      overdueDays: number;
      bucket: string;
    }> = [];

    for (const inv of allInvoices) {
      const bDue = toNumber(inv.balanceDue);
      if (bDue <= 0 || inv.status === InvoiceStatus.CANCELLED || inv.status === InvoiceStatus.DRAFT) {
        continue;
      }

      const dueTime = startOfDay(inv.dueDate).getTime();
      const overdueDays = Math.round((now - dueTime) / 86400000);

      let bucketKey = 'current';
      if (overdueDays > 90) {
        bucketKey = 'overdue90Plus';
        agingBuckets.overdue90Plus.amount = round2(agingBuckets.overdue90Plus.amount + bDue);
        agingBuckets.overdue90Plus.count += 1;
      } else if (overdueDays > 60) {
        bucketKey = 'overdue61_90';
        agingBuckets.overdue61_90.amount = round2(agingBuckets.overdue61_90.amount + bDue);
        agingBuckets.overdue61_90.count += 1;
      } else if (overdueDays > 30) {
        bucketKey = 'overdue31_60';
        agingBuckets.overdue31_60.amount = round2(agingBuckets.overdue31_60.amount + bDue);
        agingBuckets.overdue31_60.count += 1;
      } else if (overdueDays > 0) {
        bucketKey = 'overdue1_30';
        agingBuckets.overdue1_30.amount = round2(agingBuckets.overdue1_30.amount + bDue);
        agingBuckets.overdue1_30.count += 1;
      } else {
        agingBuckets.current.amount = round2(agingBuckets.current.amount + bDue);
        agingBuckets.current.count += 1;
      }

      agingList.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer?.name || inv.billingName || 'Customer',
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        grandTotal: toNumber(inv.grandTotal),
        balanceDue: bDue,
        overdueDays: Math.max(0, overdueDays),
        bucket: bucketKey
      });
    }

    agingList.sort((a, b) => b.overdueDays - a.overdueDays);

    const receivablesAnalytics = {
      totalOutstanding: totalDueAmount,
      currentReceivables: agingBuckets.current.amount,
      overdue1_30: agingBuckets.overdue1_30.amount,
      overdue31_60: agingBuckets.overdue31_60.amount,
      overdue61_90: agingBuckets.overdue61_90.amount,
      overdue90Plus: agingBuckets.overdue90Plus.amount,
      buckets: Object.values(agingBuckets),
      agingList: agingList.slice(0, 20)
    };

    return {
      periodLabel: label,
      salesAnalytics,
      invoiceAnalytics,
      paymentAnalytics,
      gstAnalytics,
      customerAnalytics,
      productAnalytics,
      receivablesAnalytics
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
