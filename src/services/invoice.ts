import { Prisma, InvoiceStatus, DocumentType, ActivityType, NotificationEvent } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';
import { Decimalish, round2, toNumber, toPaise, fromPaise, formatMoney } from '../utils/money.js';
import { addDays, financialYearOf, startOfDay, endOfDay, today } from '../utils/date.js';
import { computeDocument, resolveSupply, TaxLineInput } from './tax.js';
import { NumberingService } from './numbering.js';
import { InvoiceSettingsService } from './invoiceSettings.js';
import { NotificationService } from './notification.js';
import { ActivityService } from './activity.js';

/**
 * Invoice service.
 *
 * Two invariants hold everywhere in this file:
 *
 *  1. `companyId` is the first argument of every public method and is folded
 *     into the `where` clause, so another business's invoice is invisible
 *     rather than merely forbidden.
 *  2. Money on an invoice is never trusted from the client. Totals are always
 *     recomputed from the line items by the tax engine, so a tampered or stale
 *     payload cannot change what a customer owes.
 */

export interface InvoiceItemInput {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  /** Optional manual override; omitted means allocate from the sequence. */
  invoiceNumber?: string;
  billType?: string;
  issueDate?: string | Date;
  dueDate?: string | Date;
  poNumber?: string | null;
  orderDate?: string | Date | null;
  challanNo?: string | null;
  challanDate?: string | Date | null;
  reference?: string | null;
  modeOfDispatch?: string | null;
  lhNo?: string | null;
  lhDate?: string | Date | null;
  dcNo?: string | null;
  dcDate?: string | Date | null;
  paymentTerms?: string | null;
  currency?: string;
  placeOfSupply?: string | null;
  isReverseCharge?: boolean;
  notes?: string | null;
  terms?: string | null;
  internalNotes?: string | null;
  /** Only DRAFT or SENT may be set at creation time. */
  status?: Extract<InvoiceStatus, 'DRAFT' | 'SENT'>;
  items: InvoiceItemInput[];
}

export type UpdateInvoiceInput = Partial<CreateInvoiceInput>;

/**
 * Line input as it can arrive from either side of the boundary: numbers from a
 * request body, Prisma `Decimal`s when lines are re-read from the database.
 */
export interface RawInvoiceItem {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  unit?: string | null;
  quantity: Decimalish;
  unitPrice: Decimalish;
  discountPercent?: Decimalish;
  taxRate?: Decimalish;
}

/** A line after coercion, ready for the tax engine. */
interface NormalisedItem extends TaxLineInput {
  productId: string | null;
  name: string;
  description: string | null;
  hsnSacCode: string | null;
  unit: string;
}

export type InvoiceSortBy =
  | 'invoiceNumber'
  | 'issueDate'
  | 'dueDate'
  | 'grandTotal'
  | 'balanceDue'
  | 'billingName'
  | 'status'
  | 'createdAt'
  | 'updatedAt';

export interface ListInvoicesQuery {
  page: number;
  limit: number;
  search?: string;
  status?: InvoiceStatus[];
  billType?: string;
  customerId?: string;
  financialYear?: string;
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  /** Only invoices with money still outstanding. */
  onlyOutstanding?: boolean;
  sortBy: InvoiceSortBy;
  sortOrder: 'asc' | 'desc';
}

/** Row shape for the list view - deliberately without items or payments. */
const invoiceListSelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  billType: true,
  issueDate: true,
  dueDate: true,
  financialYear: true,
  currency: true,
  billingName: true,
  billingState: true,
  billingGstin: true,
  placeOfSupply: true,
  isIgst: true,
  subtotal: true,
  discountAmount: true,
  taxableAmount: true,
  taxAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  roundOff: true,
  grandTotal: true,
  amountPaid: true,
  creditNoteTotal: true,
  debitNoteTotal: true,
  balanceDue: true,
  poNumber: true,
  orderDate: true,
  challanNo: true,
  challanDate: true,
  modeOfDispatch: true,
  lhNo: true,
  lhDate: true,
  dcNo: true,
  dcDate: true,
  paymentTerms: true,
  sentAt: true,
  paidAt: true,
  cancelledAt: true,
  recurringInvoiceId: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  customer: { select: { id: true, name: true, type: true, email: true, isActive: true } },
  _count: { select: { payments: true } }
} satisfies Prisma.InvoiceSelect;

/** Everything needed to render or print one invoice. */
const invoiceDetailSelect = {
  ...invoiceListSelect,
  poNumber: true,
  reference: true,
  billingEmail: true,
  billingPhone: true,
  billingAddress: true,
  billingCity: true,
  billingCountry: true,
  billingPostalCode: true,
  placeOfSupplyCode: true,
  isReverseCharge: true,
  notes: true,
  terms: true,
  internalNotes: true,
  cancelledReason: true,
  viewedAt: true,
  sequenceNo: true,
  customer: {
    select: {
      id: true,
      name: true,
      type: true,
      email: true,
      phone: true,
      gstin: true,
      address: true,
      city: true,
      state: true,
      country: true,
      postalCode: true,
      isActive: true
    }
  },
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      productId: true,
      name: true,
      description: true,
      hsnSacCode: true,
      unit: true,
      sortOrder: true,
      quantity: true,
      unitPrice: true,
      discountPercent: true,
      discountAmount: true,
      taxRate: true,
      subtotal: true,
      taxableAmount: true,
      cgstRate: true,
      cgstAmount: true,
      sgstRate: true,
      sgstAmount: true,
      igstRate: true,
      igstAmount: true,
      taxAmount: true,
      total: true
    }
  },
  payments: {
    orderBy: { paymentDate: 'desc' },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      referenceNumber: true,
      notes: true,
      createdAt: true
    }
  },
  notesDocs: {
    where: { status: { not: 'CANCELLED' } },
    orderBy: { noteDate: 'desc' },
    select: {
      id: true,
      noteType: true,
      noteNumber: true,
      noteDate: true,
      status: true,
      grandTotal: true,
      reason: true
    }
  }
} satisfies Prisma.InvoiceSelect;

export type InvoiceDetail = Prisma.InvoiceGetPayload<{ select: typeof invoiceDetailSelect }>;

/** Statuses that represent a live receivable. */
export const OPEN_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE
];

/** Statuses that count towards revenue - a cancelled invoice never does. */
export const COUNTED_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID
];

/** What a user is allowed to change, given where the invoice is in its life. */
export type EditMode = 'full' | 'limited' | 'none';

interface AmountState {
  grandTotal: number;
  amountPaid: number;
  creditNoteTotal: number;
  debitNoteTotal: number;
  dueDate: Date;
  status: InvoiceStatus;
}

export class InvoiceService {
  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Outstanding balance, never negative: an overpayment is not a credit here. */
  static computeBalance(state: Omit<AmountState, 'dueDate' | 'status'>): number {
    const balance =
      toPaise(state.grandTotal) +
      toPaise(state.debitNoteTotal) -
      toPaise(state.creditNoteTotal) -
      toPaise(state.amountPaid);

    return fromPaise(Math.max(0, balance));
  }

  /**
   * Single source of truth for an invoice's status.
   *
   * Derived rather than stored-and-edited so a payment, a credit note and the
   * passage of time all land on the same answer. A draft stays a draft until
   * someone sends it, and a cancelled invoice is terminal.
   */
  static deriveStatus(state: AmountState): InvoiceStatus {
    if (state.status === InvoiceStatus.CANCELLED) return InvoiceStatus.CANCELLED;
    if (state.status === InvoiceStatus.DRAFT) return InvoiceStatus.DRAFT;

    const balance = this.computeBalance(state);

    if (balance <= 0 && toNumber(state.grandTotal) > 0) return InvoiceStatus.PAID;
    // Overdue outranks partially-paid: what matters is that money is late.
    if (startOfDay(state.dueDate) < today()) return InvoiceStatus.OVERDUE;
    if (toNumber(state.amountPaid) > 0) return InvoiceStatus.PARTIALLY_PAID;

    return InvoiceStatus.SENT;
  }

  /**
   * Recomputes derived money and status from whatever is currently stored.
   * Called after any payment or note change so those services never have to
   * reimplement the rules.
   */
  static async syncState(
    invoiceId: string,
    client: Prisma.TransactionClient = prisma
  ): Promise<void> {
    const invoice = await client.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        companyId: true,
        invoiceNumber: true,
        status: true,
        dueDate: true,
        grandTotal: true,
        amountPaid: true,
        paidAt: true
      }
    });

    if (!invoice) return;

    const [paymentAgg, creditAgg, debitAgg] = await Promise.all([
      client.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } }),
      client.creditDebitNote.aggregate({
        where: { invoiceId, noteType: 'CREDIT', status: 'ISSUED' },
        _sum: { grandTotal: true }
      }),
      client.creditDebitNote.aggregate({
        where: { invoiceId, noteType: 'DEBIT', status: 'ISSUED' },
        _sum: { grandTotal: true }
      })
    ]);

    const amountPaid = round2(paymentAgg._sum.amount ?? 0);
    const creditNoteTotal = round2(creditAgg._sum.grandTotal ?? 0);
    const debitNoteTotal = round2(debitAgg._sum.grandTotal ?? 0);

    const balanceDue = this.computeBalance({
      grandTotal: toNumber(invoice.grandTotal),
      amountPaid,
      creditNoteTotal,
      debitNoteTotal
    });

    const status = this.deriveStatus({
      grandTotal: toNumber(invoice.grandTotal),
      amountPaid,
      creditNoteTotal,
      debitNoteTotal,
      dueDate: invoice.dueDate,
      status: invoice.status
    });

    await client.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid,
        creditNoteTotal,
        debitNoteTotal,
        balanceDue,
        status,
        paidAt:
          status === InvoiceStatus.PAID ? invoice.paidAt ?? new Date() : null
      }
    });

    // Only on the transition, so re-syncing a settled invoice stays silent.
    if (status === InvoiceStatus.PAID && invoice.status !== InvoiceStatus.PAID) {
      await NotificationService.notify({
        companyId: invoice.companyId,
        event: NotificationEvent.INVOICE_PAID,
        title: `Invoice ${invoice.invoiceNumber} fully settled`,
        body: `${formatMoney(invoice.grandTotal)} received in full`,
        link: `/invoices/${invoice.id}`
      });
    }
  }

  /**
   * Flips past-due invoices to OVERDUE.
   *
   * Status depends on the current date, so it has to be refreshed before any
   * read that reports on it. `updateMany` makes this one cheap statement that
   * is safe to run on every list request.
   */
  static async refreshOverdue(companyId: string): Promise<void> {
    const settings = await InvoiceSettingsService.getOrCreate(companyId);
    if (!settings.autoMarkOverdue) return;

    const now = today();

    const where: Prisma.InvoiceWhereInput = {
      companyId,
      status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID] },
      dueDate: { lt: now },
      balanceDue: { gt: 0 }
    };

    // Read the invoices about to flip *before* the update, so the alert names
    // them. Skipped entirely when nobody is subscribed to the event.
    const settingsWantOverdueAlerts = settings.notifyEvents.includes(
      NotificationEvent.INVOICE_OVERDUE
    );

    const becomingOverdue = settingsWantOverdueAlerts
      ? await prisma.invoice.findMany({
          where,
          select: { id: true, invoiceNumber: true, balanceDue: true },
          take: 25
        })
      : [];

    await prisma.invoice.updateMany({
      where,
      data: { status: InvoiceStatus.OVERDUE }
    });

    for (const invoice of becomingOverdue) {
      await NotificationService.notify({
        companyId,
        event: NotificationEvent.INVOICE_OVERDUE,
        title: `Invoice ${invoice.invoiceNumber} is overdue`,
        body: `${formatMoney(invoice.balanceDue)} is still outstanding`,
        link: `/invoices/${invoice.id}`
      });
    }
  }

  /** How much of the invoice a user may still change. */
  static editMode(invoice: { status: InvoiceStatus; amountPaid: Prisma.Decimal | number }): EditMode {
    if (invoice.status === InvoiceStatus.CANCELLED) return 'none';
    if (invoice.status === InvoiceStatus.DRAFT) return 'full';
    // Once money has been received against it, the figures are part of a
    // reconciled record; only the surrounding detail stays editable.
    if (toNumber(invoice.amountPaid) > 0) return 'limited';
    return 'full';
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  static async list(companyId: string, query: ListInvoicesQuery) {
    await this.refreshOverdue(companyId);

    const where = this.buildWhere(companyId, query);
    const skip = (query.page - 1) * query.limit;

    const orderBy: Prisma.InvoiceOrderByWithRelationInput =
      query.sortBy === 'billingName'
        ? { billingName: query.sortOrder }
        : { [query.sortBy]: query.sortOrder };

    const [invoices, total, totals] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        select: invoiceListSelect,
        orderBy,
        skip,
        take: query.limit
      }),
      prisma.invoice.count({ where }),
      // Totals for the filtered set, not just the visible page - the list
      // footer needs to describe the whole selection.
      prisma.invoice.aggregate({
        where,
        _sum: { grandTotal: true, amountPaid: true, balanceDue: true }
      })
    ]);

    const totalPages = Math.ceil(total / query.limit);

    const meta: PaginationMeta = {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1
    };

    return {
      invoices,
      meta,
      summary: {
        totalAmount: round2(totals._sum.grandTotal ?? 0),
        paidAmount: round2(totals._sum.amountPaid ?? 0),
        outstandingAmount: round2(totals._sum.balanceDue ?? 0)
      }
    };
  }

  static async getById(companyId: string, id: string): Promise<InvoiceDetail> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: invoiceDetailSelect
    });

    if (!invoice) {
      throw AppError.notFound('Invoice not found');
    }

    return invoice;
  }

  /**
   * Stat cards for the invoice dashboard.
   *
   * Each figure is a separate aggregate over an index-backed filter, which is
   * faster and far clearer than loading rows and reducing them in JS.
   */
  static async dashboard(
    companyId: string,
    options: { financialYear?: string; dateFrom?: string; dateTo?: string } = {}
  ) {
    await this.refreshOverdue(companyId);

    const scope: Prisma.InvoiceWhereInput = { companyId };

    if (options.financialYear) {
      scope.financialYear = options.financialYear;
    }

    if (options.dateFrom || options.dateTo) {
      scope.issueDate = {
        ...(options.dateFrom && { gte: startOfDay(options.dateFrom) }),
        ...(options.dateTo && { lte: endOfDay(options.dateTo) })
      };
    }

    const counted: Prisma.InvoiceWhereInput = {
      ...scope,
      status: { in: COUNTED_STATUSES }
    };

    const [all, paid, outstanding, overdue, draft, unpaid, statusGroups, taxAgg, recentInvoicesList, recentAllInvoices] = await prisma.$transaction([
      prisma.invoice.aggregate({
        where: counted,
        _sum: { grandTotal: true, amountPaid: true, balanceDue: true, taxAmount: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...scope, status: InvoiceStatus.PAID },
        _sum: { grandTotal: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...scope, status: { in: OPEN_STATUSES } },
        _sum: { balanceDue: true, grandTotal: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...scope, status: InvoiceStatus.OVERDUE },
        _sum: { balanceDue: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...scope, status: InvoiceStatus.DRAFT },
        _sum: { grandTotal: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...scope, status: { in: OPEN_STATUSES } },
        _sum: { grandTotal: true }
      }),
      prisma.invoice.groupBy({
        by: ['status'],
        where: scope,
        orderBy: { status: 'asc' },
        _count: true,
        _sum: { grandTotal: true, balanceDue: true }
      }),
      prisma.invoice.aggregate({
        where: scope,
        _sum: {
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          taxAmount: true,
          taxableAmount: true,
          subtotal: true
        }
      }),
      prisma.invoice.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          invoiceNumber: true,
          billingName: true,
          grandTotal: true,
          balanceDue: true,
          amountPaid: true,
          status: true,
          billType: true,
          issueDate: true,
          dueDate: true,
          customer: { select: { id: true, name: true, city: true, state: true } }
        }
      }),
      prisma.invoice.findMany({
        where: scope,
        select: {
          id: true,
          customerId: true,
          billingName: true,
          grandTotal: true,
          amountPaid: true,
          issueDate: true,
          status: true
        }
      })
    ]);

    const byStatus = Object.values(InvoiceStatus).map((status) => {
      const row = statusGroups.find((group) => group.status === status);
      return {
        status,
        count: row?._count ?? 0,
        amount: round2(row?._sum?.grandTotal ?? 0),
        balanceDue: round2(row?._sum?.balanceDue ?? 0)
      };
    });

    // Generate monthly revenue trends for last 6 calendar months
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const monthlyTrends: { month: string; year: number; invoiced: number; collected: number; count: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const mIdx = d.getUTCMonth();
      const y = d.getUTCFullYear();
      const label = `${monthNames[mIdx]} ${y}`;

      const invoicesInMonth = recentAllInvoices.filter((inv) => {
        const invDate = new Date(inv.issueDate);
        return invDate.getUTCFullYear() === y && invDate.getUTCMonth() === mIdx;
      });

      const invoiced = round2(
        invoicesInMonth.reduce(
          (acc, inv) => acc + (inv.status !== InvoiceStatus.CANCELLED ? toNumber(inv.grandTotal) : 0),
          0
        )
      );
      const collected = round2(
        invoicesInMonth.reduce((acc, inv) => acc + toNumber(inv.amountPaid), 0)
      );

      monthlyTrends.push({
        month: label,
        year: y,
        invoiced,
        collected,
        count: invoicesInMonth.length
      });
    }

    // Top 5 Customers by revenue
    const customerMap = new Map<
      string,
      { customerId: string; name: string; totalInvoiced: number; totalPaid: number; count: number }
    >();

    for (const inv of recentAllInvoices) {
      if (inv.status === InvoiceStatus.CANCELLED) continue;
      const key = inv.customerId || inv.billingName;
      const existing = customerMap.get(key) || {
        customerId: inv.customerId,
        name: inv.billingName || 'Unknown Customer',
        totalInvoiced: 0,
        totalPaid: 0,
        count: 0
      };
      existing.totalInvoiced = round2(existing.totalInvoiced + toNumber(inv.grandTotal));
      existing.totalPaid = round2(existing.totalPaid + toNumber(inv.amountPaid));
      existing.count += 1;
      customerMap.set(key, existing);
    }

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.totalInvoiced - a.totalInvoiced)
      .slice(0, 5);

    return {
      totalInvoices: all._count,
      totalAmount: round2(all._sum.grandTotal ?? 0),
      totalTax: round2(all._sum.taxAmount ?? 0),
      paidAmount: round2(all._sum.amountPaid ?? 0),
      paidInvoices: paid._count,
      fullyPaidAmount: round2(paid._sum.grandTotal ?? 0),
      /** Invoiced but not yet settled, at full document value. */
      unpaidAmount: round2(unpaid._sum.grandTotal ?? 0),
      unpaidInvoices: outstanding._count,
      /** The real receivable: what is still collectable right now. */
      outstandingAmount: round2(outstanding._sum.balanceDue ?? 0),
      overdueAmount: round2(overdue._sum.balanceDue ?? 0),
      overdueInvoices: overdue._count,
      draftAmount: round2(draft._sum.grandTotal ?? 0),
      draftInvoices: draft._count,
      byStatus,
      recentInvoices: recentInvoicesList,
      monthlyTrends,
      topCustomers,
      gstSummary: {
        cgst: round2(taxAgg._sum.cgstAmount ?? 0),
        sgst: round2(taxAgg._sum.sgstAmount ?? 0),
        igst: round2(taxAgg._sum.igstAmount ?? 0),
        taxableAmount: round2(taxAgg._sum.taxableAmount ?? 0),
        totalTax: round2(taxAgg._sum.taxAmount ?? 0)
      }
    };
  }

  private static buildWhere(companyId: string, query: ListInvoicesQuery): Prisma.InvoiceWhereInput {
    const {
      search,
      status,
      billType,
      customerId,
      financialYear,
      year,
      month,
      dateFrom,
      dateTo,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      onlyOutstanding
    } = query;

    // A month filter is meaningless without a year, so fall back to the
    // current calendar year rather than silently ignoring it.
    const resolvedYear = month && !year ? new Date().getUTCFullYear() : year;

    const effectiveDateFrom = dateFrom || startDate;
    const effectiveDateTo = dateTo || endDate;

    let issueDate: Prisma.DateTimeFilter | undefined;

    if (effectiveDateFrom || effectiveDateTo) {
      issueDate = {
        ...(effectiveDateFrom && { gte: startOfDay(effectiveDateFrom) }),
        ...(effectiveDateTo && { lte: endOfDay(effectiveDateTo) })
      };
    } else if (resolvedYear && month) {
      issueDate = {
        gte: new Date(Date.UTC(resolvedYear, month - 1, 1)),
        lte: new Date(Date.UTC(resolvedYear, month, 0, 23, 59, 59, 999))
      };
    } else if (resolvedYear) {
      issueDate = {
        gte: new Date(Date.UTC(resolvedYear, 0, 1)),
        lte: new Date(Date.UTC(resolvedYear, 11, 31, 23, 59, 59, 999))
      };
    }

    return {
      companyId,
      ...(status?.length && { status: { in: status } }),
      ...(billType && { billType: { equals: billType, mode: 'insensitive' as const } }),
      ...(customerId && { customerId }),
      ...(financialYear && { financialYear }),
      ...(issueDate && { issueDate }),
      ...((minAmount !== undefined || maxAmount !== undefined) && {
        grandTotal: {
          ...(minAmount !== undefined && { gte: minAmount }),
          ...(maxAmount !== undefined && { lte: maxAmount })
        }
      }),
      ...(onlyOutstanding && {
        balanceDue: { gt: 0 },
        status: { in: status?.length ? status : OPEN_STATUSES }
      }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
          { billingName: { contains: search, mode: 'insensitive' as const } },
          { billingGstin: { contains: search, mode: 'insensitive' as const } },
          { poNumber: { contains: search, mode: 'insensitive' as const } },
          { challanNo: { contains: search, mode: 'insensitive' as const } },
          { reference: { contains: search, mode: 'insensitive' as const } },
          { modeOfDispatch: { contains: search, mode: 'insensitive' as const } },
          { lhNo: { contains: search, mode: 'insensitive' as const } },
          { dcNo: { contains: search, mode: 'insensitive' as const } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { email: { contains: search, mode: 'insensitive' as const } } }
        ]
      })
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  static async create(
    companyId: string,
    input: CreateInvoiceInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<InvoiceDetail> {
    if (!input.items?.length) {
      throw AppError.badRequest('An invoice needs at least one line item');
    }

    const [company, customer, settings] = await Promise.all([
      this.getCompanyProfile(companyId),
      this.getCustomer(companyId, input.customerId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    const issueDate = startOfDay(input.issueDate ?? new Date());
    const dueDate = input.dueDate
      ? startOfDay(input.dueDate)
      : startOfDay(addDays(issueDate, settings.defaultDueDays));

    if (dueDate < issueDate) {
      throw AppError.badRequest('Due date cannot be earlier than the issue date');
    }

    const supply = resolveSupply(company.state, customer.state, input.placeOfSupply);
    const computed = computeDocument(this.normaliseItems(input.items), {
      isIgst: supply.isIgst,
      enableRoundOff: settings.enableRoundOff,
      gstEnabled: settings.gstEnabled,
      pricesIncludeTax: settings.pricesIncludeTax
    });

    const status = input.status === InvoiceStatus.SENT ? InvoiceStatus.SENT : InvoiceStatus.DRAFT;

    const created = await prisma.$transaction(
      async (tx) => {
        const numbering = input.invoiceNumber
          ? await this.useManualNumber(tx, companyId, input.invoiceNumber, issueDate)
          : await NumberingService.allocate(tx, companyId, DocumentType.INVOICE, issueDate);

        const invoice = await tx.invoice.create({
          data: {
            companyId,
            customerId: customer.id,
            invoiceNumber: numbering.number,
            sequenceNo: numbering.sequenceNo,
            financialYear: numbering.financialYear,
            status,
            billType: input.billType ?? 'TAX_INVOICE',
            issueDate,
            dueDate,
            poNumber: input.poNumber ?? null,
            orderDate: input.orderDate ? startOfDay(input.orderDate) : null,
            challanNo: input.challanNo ?? null,
            challanDate: input.challanDate ? startOfDay(input.challanDate) : null,
            reference: input.reference ?? null,
            modeOfDispatch: input.modeOfDispatch ?? null,
            lhNo: input.lhNo ?? null,
            lhDate: input.lhDate ? startOfDay(input.lhDate) : null,
            dcNo: input.dcNo ?? null,
            dcDate: input.dcDate ? startOfDay(input.dcDate) : null,
            paymentTerms: input.paymentTerms ?? null,
            currency: input.currency ?? settings.defaultCurrency,

            // Snapshot the buyer so a later edit to the customer record cannot
            // rewrite an already-issued document.
            billingName: customer.name,
            billingEmail: customer.email,
            billingPhone: customer.phone,
            billingGstin: customer.gstin,
            billingAddress: customer.address,
            billingCity: customer.city,
            billingState: customer.state,
            billingCountry: customer.country ?? 'India',
            billingPostalCode: customer.postalCode,

            placeOfSupply: supply.placeOfSupply,
            placeOfSupplyCode: supply.placeOfSupplyCode,
            isIgst: supply.isIgst,
            isReverseCharge: input.isReverseCharge ?? false,

            subtotal: computed.subtotal,
            discountAmount: computed.discountAmount,
            taxableAmount: computed.taxableAmount,
            taxAmount: computed.taxAmount,
            cgstAmount: computed.cgstAmount,
            sgstAmount: computed.sgstAmount,
            igstAmount: computed.igstAmount,
            roundOff: computed.roundOff,
            grandTotal: computed.grandTotal,
            amountPaid: 0,
            balanceDue: computed.grandTotal,

            notes: input.notes ?? settings.defaultNotes,
            terms: input.terms ?? settings.defaultTerms,
            internalNotes: input.internalNotes ?? null,
            sentAt: status === InvoiceStatus.SENT ? new Date() : null,

            items: {
              create: computed.lines.map((line, index) => ({
                productId: line.productId ?? null,
                name: line.name,
                description: line.description ?? null,
                hsnSacCode: line.hsnSacCode ?? null,
                unit: line.unit ?? 'PCS',
                sortOrder: index,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPercent: line.discountPercent,
                discountAmount: line.discountAmount,
                taxRate: line.taxRate,
                subtotal: line.subtotal,
                taxableAmount: line.taxableAmount,
                cgstRate: line.cgstRate,
                cgstAmount: line.cgstAmount,
                sgstRate: line.sgstRate,
                sgstAmount: line.sgstAmount,
                igstRate: line.igstRate,
                igstAmount: line.igstAmount,
                taxAmount: line.taxAmount,
                total: line.total
              }))
            }
          },
          select: { id: true, invoiceNumber: true, grandTotal: true }
        });

        return invoice;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    await ActivityService.log({
      companyId,
      invoiceId: created.id,
      userId: context.userId,
      action: ActivityType.CREATED,
      description: `Invoice ${created.invoiceNumber} created as ${status.toLowerCase()}`,
      metadata: { grandTotal: computed.grandTotal, itemCount: computed.lines.length },
      ipAddress: context.ipAddress
    });

    await NotificationService.notify({
      companyId,
      event: NotificationEvent.INVOICE_CREATED,
      title: `Invoice ${created.invoiceNumber} created`,
      body: `${customer.name} - ${formatMoney(computed.grandTotal)}`,
      link: `/invoices/${created.id}`,
      actorUserId: context.userId
    });

    return this.getById(companyId, created.id);
  }

  static async update(
    companyId: string,
    id: string,
    input: UpdateInvoiceInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<InvoiceDetail> {
    const existing = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        dueDate: true,
        customerId: true,
        amountPaid: true,
        creditNoteTotal: true,
        debitNoteTotal: true,
        currency: true,
        placeOfSupply: true
      }
    });

    if (!existing) {
      throw AppError.notFound('Invoice not found');
    }

    const mode = this.editMode(existing);

    if (mode === 'none') {
      throw AppError.badRequest('A cancelled invoice can no longer be edited');
    }

    if (mode === 'limited' && (input.items || input.customerId)) {
      throw AppError.badRequest(
        'This invoice has recorded payments. Delete the payments first to change its customer or line items.'
      );
    }

    const settings = await InvoiceSettingsService.getOrCreate(companyId);

    const issueDate = input.issueDate ? startOfDay(input.issueDate) : existing.issueDate;
    const dueDate = input.dueDate ? startOfDay(input.dueDate) : existing.dueDate;

    if (startOfDay(dueDate) < startOfDay(issueDate)) {
      throw AppError.badRequest('Due date cannot be earlier than the issue date');
    }

    const data: Prisma.InvoiceUpdateInput = {
      issueDate,
      dueDate,
      ...(input.billType !== undefined && { billType: input.billType }),
      ...('poNumber' in input && { poNumber: input.poNumber ?? null }),
      ...('orderDate' in input && { orderDate: input.orderDate ? startOfDay(input.orderDate) : null }),
      ...('challanNo' in input && { challanNo: input.challanNo ?? null }),
      ...('challanDate' in input && { challanDate: input.challanDate ? startOfDay(input.challanDate) : null }),
      ...('reference' in input && { reference: input.reference ?? null }),
      ...('modeOfDispatch' in input && { modeOfDispatch: input.modeOfDispatch ?? null }),
      ...('lhNo' in input && { lhNo: input.lhNo ?? null }),
      ...('lhDate' in input && { lhDate: input.lhDate ? startOfDay(input.lhDate) : null }),
      ...('dcNo' in input && { dcNo: input.dcNo ?? null }),
      ...('dcDate' in input && { dcDate: input.dcDate ? startOfDay(input.dcDate) : null }),
      ...('paymentTerms' in input && { paymentTerms: input.paymentTerms ?? null }),
      ...('notes' in input && { notes: input.notes ?? null }),
      ...('terms' in input && { terms: input.terms ?? null }),
      ...('internalNotes' in input && { internalNotes: input.internalNotes ?? null }),
      ...(input.currency && { currency: input.currency }),
      ...(input.isReverseCharge !== undefined && { isReverseCharge: input.isReverseCharge })
    };

    // Re-pricing is only reachable in 'full' mode, guarded above.
    if (mode === 'full' && (input.items || input.customerId || input.placeOfSupply !== undefined)) {
      const company = await this.getCompanyProfile(companyId);
      const customer = await this.getCustomer(companyId, input.customerId ?? existing.customerId);

      const supply = resolveSupply(
        company.state,
        customer.state,
        input.placeOfSupply !== undefined ? input.placeOfSupply : existing.placeOfSupply
      );

      if (input.customerId && input.customerId !== existing.customerId) {
        data.customer = { connect: { id: customer.id } };
        // Refresh the snapshot, since the document now belongs to someone else.
        data.billingName = customer.name;
        data.billingEmail = customer.email;
        data.billingPhone = customer.phone;
        data.billingGstin = customer.gstin;
        data.billingAddress = customer.address;
        data.billingCity = customer.city;
        data.billingState = customer.state;
        data.billingCountry = customer.country ?? 'India';
        data.billingPostalCode = customer.postalCode;
      }

      data.placeOfSupply = supply.placeOfSupply;
      data.placeOfSupplyCode = supply.placeOfSupplyCode;
      data.isIgst = supply.isIgst;

      if (input.items) {
        if (!input.items.length) {
          throw AppError.badRequest('An invoice needs at least one line item');
        }

        const computed = computeDocument(this.normaliseItems(input.items), {
          isIgst: supply.isIgst,
          enableRoundOff: settings.enableRoundOff,
          gstEnabled: settings.gstEnabled,
          pricesIncludeTax: settings.pricesIncludeTax
        });

        Object.assign(data, {
          subtotal: computed.subtotal,
          discountAmount: computed.discountAmount,
          taxableAmount: computed.taxableAmount,
          taxAmount: computed.taxAmount,
          cgstAmount: computed.cgstAmount,
          sgstAmount: computed.sgstAmount,
          igstAmount: computed.igstAmount,
          roundOff: computed.roundOff,
          grandTotal: computed.grandTotal,
          balanceDue: this.computeBalance({
            grandTotal: computed.grandTotal,
            amountPaid: toNumber(existing.amountPaid),
            creditNoteTotal: toNumber(existing.creditNoteTotal),
            debitNoteTotal: toNumber(existing.debitNoteTotal)
          })
        });

        // Lines are replaced wholesale: they carry no identity a client could
        // reliably send back, and a diff would risk orphaned rows.
        data.items = {
          deleteMany: {},
          create: computed.lines.map((line, index) => ({
            productId: line.productId ?? null,
            name: line.name,
            description: line.description ?? null,
            hsnSacCode: line.hsnSacCode ?? null,
            unit: line.unit ?? 'PCS',
            sortOrder: index,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            discountAmount: line.discountAmount,
            taxRate: line.taxRate,
            subtotal: line.subtotal,
            taxableAmount: line.taxableAmount,
            cgstRate: line.cgstRate,
            cgstAmount: line.cgstAmount,
            sgstRate: line.sgstRate,
            sgstAmount: line.sgstAmount,
            igstRate: line.igstRate,
            igstAmount: line.igstAmount,
            taxAmount: line.taxAmount,
            total: line.total
          }))
        };
      } else if (data.isIgst !== undefined) {
        // The CGST/SGST vs IGST split changed without the lines changing, so
        // the existing lines have to be re-split at the same rates.
        await this.resplitExistingItems(
          id,
          supply.isIgst,
          {
            enableRoundOff: settings.enableRoundOff,
            gstEnabled: settings.gstEnabled,
            pricesIncludeTax: settings.pricesIncludeTax
          },
          data
        );
      }
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.invoice.update({ where: { id }, data });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    await ActivityService.log({
      companyId,
      invoiceId: id,
      userId: context.userId,
      action: ActivityType.UPDATED,
      description: `Invoice ${existing.invoiceNumber} updated`,
      metadata: { mode, fields: Object.keys(input) },
      ipAddress: context.ipAddress
    });

    // Totals may have moved; let the shared rules settle status and balance.
    await this.syncState(id);

    return this.getById(companyId, id);
  }

  /**
   * Recomputes the CGST/SGST/IGST split on stored lines when only the place of
   * supply changed. Amounts stay identical - the split does not.
   */
  private static async resplitExistingItems(
    invoiceId: string,
    isIgst: boolean,
    taxOptions: { enableRoundOff: boolean; gstEnabled: boolean; pricesIncludeTax: boolean },
    data: Prisma.InvoiceUpdateInput
  ): Promise<void> {
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      orderBy: { sortOrder: 'asc' },
      select: {
        productId: true,
        name: true,
        description: true,
        hsnSacCode: true,
        unit: true,
        quantity: true,
        unitPrice: true,
        discountPercent: true,
        taxRate: true
      }
    });

    if (!items.length) return;

    const computed = computeDocument(this.normaliseItems(items), {
      isIgst,
      ...taxOptions
    });

    Object.assign(data, {
      subtotal: computed.subtotal,
      discountAmount: computed.discountAmount,
      taxableAmount: computed.taxableAmount,
      taxAmount: computed.taxAmount,
      cgstAmount: computed.cgstAmount,
      sgstAmount: computed.sgstAmount,
      igstAmount: computed.igstAmount,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal
    });

    data.items = {
      deleteMany: {},
      create: computed.lines.map((line, index) => ({
        productId: line.productId ?? null,
        name: line.name,
        description: line.description ?? null,
        hsnSacCode: line.hsnSacCode ?? null,
        unit: line.unit ?? 'PCS',
        sortOrder: index,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        taxRate: line.taxRate,
        subtotal: line.subtotal,
        taxableAmount: line.taxableAmount,
        cgstRate: line.cgstRate,
        cgstAmount: line.cgstAmount,
        sgstRate: line.sgstRate,
        sgstAmount: line.sgstAmount,
        igstRate: line.igstRate,
        igstAmount: line.igstAmount,
        taxAmount: line.taxAmount,
        total: line.total
      }))
    };
  }

  /**
   * Moves an invoice between statuses that a user controls directly.
   *
   * Paid / partially paid / overdue are all derived from money and dates, so
   * they are deliberately not settable by hand - only DRAFT and SENT are.
   */
  static async setStatus(
    companyId: string,
    id: string,
    status: Extract<InvoiceStatus, 'DRAFT' | 'SENT'>,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<InvoiceDetail> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true, invoiceNumber: true, status: true, amountPaid: true, sentAt: true }
    });

    if (!invoice) throw AppError.notFound('Invoice not found');

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('A cancelled invoice cannot change status');
    }

    if (status === InvoiceStatus.DRAFT && toNumber(invoice.amountPaid) > 0) {
      throw AppError.badRequest('An invoice with recorded payments cannot be moved back to draft');
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: {
            status,
            sentAt: status === InvoiceStatus.SENT ? invoice.sentAt ?? new Date() : null
          }
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    await ActivityService.log({
      companyId,
      invoiceId: id,
      userId: context.userId,
      action: ActivityType.STATUS_CHANGED,
      description: `Status changed from ${invoice.status} to ${status}`,
      metadata: { from: invoice.status, to: status },
      ipAddress: context.ipAddress
    });

    await this.syncState(id);
    return this.getById(companyId, id);
  }

  /**
   * Cancels an invoice.
   *
   * Cancelling rather than deleting is the point: the number stays consumed and
   * the document stays auditable, which is what the tax record requires.
   */
  static async cancel(
    companyId: string,
    id: string,
    reason: string | undefined,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<InvoiceDetail> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true, invoiceNumber: true, status: true, amountPaid: true }
    });

    if (!invoice) throw AppError.notFound('Invoice not found');

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('This invoice is already cancelled');
    }

    if (toNumber(invoice.amountPaid) > 0) {
      throw AppError.badRequest(
        'This invoice has recorded payments. Issue a credit note instead of cancelling it.'
      );
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.invoice.update({
          where: { id },
          data: {
            status: InvoiceStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledReason: reason ?? null,
            balanceDue: 0
          }
        });

        // Pending reminders for a cancelled invoice would chase money that is no
        // longer owed.
        await tx.paymentReminder.updateMany({
          where: { invoiceId: id, status: 'SCHEDULED' },
          data: { status: 'CANCELLED' }
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    await ActivityService.log({
      companyId,
      invoiceId: id,
      userId: context.userId,
      action: ActivityType.CANCELLED,
      description: reason
        ? `Invoice cancelled: ${reason}`
        : `Invoice ${invoice.invoiceNumber} cancelled`,
      metadata: { reason: reason ?? null, previousStatus: invoice.status },
      ipAddress: context.ipAddress
    });

    return this.getById(companyId, id);
  }

  /**
   * Copies an invoice into a fresh draft with a new number and today's dates.
   * Payments, activity and the sent/paid timeline are intentionally not copied.
   */
  static async duplicate(
    companyId: string,
    id: string,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<InvoiceDetail> {
    const source = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: {
        customerId: true,
        invoiceNumber: true,
        billType: true,
        currency: true,
        poNumber: true,
        orderDate: true,
        challanNo: true,
        challanDate: true,
        reference: true,
        modeOfDispatch: true,
        lhNo: true,
        lhDate: true,
        dcNo: true,
        dcDate: true,
        paymentTerms: true,
        placeOfSupply: true,
        isReverseCharge: true,
        notes: true,
        terms: true,
        internalNotes: true,
        dueDate: true,
        issueDate: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            productId: true,
            name: true,
            description: true,
            hsnSacCode: true,
            unit: true,
            quantity: true,
            unitPrice: true,
            discountPercent: true,
            taxRate: true
          }
        }
      }
    });

    if (!source) throw AppError.notFound('Invoice not found');

    // Keep the original payment window rather than the original dates.
    const originalTermDays = Math.max(
      0,
      Math.round(
        (startOfDay(source.dueDate).getTime() - startOfDay(source.issueDate).getTime()) / 86400000
      )
    );

    const issueDate = today();

    const duplicated = await this.create(
      companyId,
      {
        customerId: source.customerId,
        billType: source.billType,
        issueDate,
        dueDate: addDays(issueDate, originalTermDays),
        poNumber: source.poNumber,
        orderDate: source.orderDate,
        challanNo: source.challanNo,
        challanDate: source.challanDate,
        reference: source.reference,
        modeOfDispatch: source.modeOfDispatch,
        lhNo: source.lhNo,
        lhDate: source.lhDate,
        dcNo: source.dcNo,
        dcDate: source.dcDate,
        paymentTerms: source.paymentTerms,
        currency: source.currency,
        placeOfSupply: source.placeOfSupply,
        isReverseCharge: source.isReverseCharge,
        notes: source.notes,
        terms: source.terms,
        internalNotes: source.internalNotes,
        status: InvoiceStatus.DRAFT,
        items: source.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          description: item.description,
          hsnSacCode: item.hsnSacCode,
          unit: item.unit,
          quantity: toNumber(item.quantity),
          unitPrice: toNumber(item.unitPrice),
          discountPercent: toNumber(item.discountPercent),
          taxRate: toNumber(item.taxRate)
        }))
      },
      context
    );

    await ActivityService.log({
      companyId,
      invoiceId: duplicated.id,
      userId: context.userId,
      action: ActivityType.DUPLICATED,
      description: `Duplicated from invoice ${source.invoiceNumber}`,
      metadata: { sourceInvoiceId: id, sourceInvoiceNumber: source.invoiceNumber },
      ipAddress: context.ipAddress
    });

    return duplicated;
  }

  /**
   * Hard-deletes an invoice. Only a draft qualifies: anything that has been
   * issued must be cancelled so its number is never reused.
   */
  static async remove(companyId: string, id: string): Promise<{ id: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, invoiceNumber: true }
    });

    if (!invoice) throw AppError.notFound('Invoice not found');

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw AppError.badRequest(
        `Invoice ${invoice.invoiceNumber} has been issued and cannot be deleted. Cancel it instead.`
      );
    }

    await prisma.invoice.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Fills in the defaults a fresh create form needs, in one round trip. */
  static async newInvoiceDefaults(companyId: string) {
    const [settings, preview, company] = await Promise.all([
      InvoiceSettingsService.getOrCreate(companyId),
      NumberingService.preview(companyId, DocumentType.INVOICE),
      this.getCompanyProfile(companyId)
    ]);

    const issueDate = today();

    return {
      invoiceNumber: preview.number,
      sequenceNo: preview.sequenceNo,
      issueDate,
      dueDate: addDays(issueDate, settings.defaultDueDays),
      financialYear: financialYearOf(issueDate),
      currency: settings.defaultCurrency,
      defaultTaxRate: toNumber(settings.defaultTaxRate),
      defaultDueDays: settings.defaultDueDays,
      notes: settings.defaultNotes,
      terms: settings.defaultTerms,
      enableRoundOff: settings.enableRoundOff,
      showHsnColumn: settings.showHsnColumn,
      showDiscount: settings.showDiscount,
      // The form mirrors these so its live preview matches what the server will
      // compute when the invoice is saved.
      gstEnabled: settings.gstEnabled,
      pricesIncludeTax: settings.pricesIncludeTax,
      enableReverseCharge: settings.enableReverseCharge,
      defaultUnit: settings.defaultUnit,
      defaultDiscountMode: settings.defaultDiscountMode,
      sellerState: company.state,
      sellerGstin: company.gstin
    };
  }

  static async getCompanyProfile(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        gstin: true,
        pan: true,
        logoUrl: true,
        bankName: true,
        accountNumber: true,
        ifscCode: true,
        branch: true,
        accountHolder: true,
        upiId: true,
        paymentInstructions: true,
        acceptedPaymentMethods: true
      }
    });

    if (!company) {
      throw AppError.notFound('No business profile found for this account');
    }

    return company;
  }

  private static async getCustomer(companyId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        gstin: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        isActive: true
      }
    });

    if (!customer) {
      throw AppError.badRequest('Selected customer was not found in your business');
    }

    return customer;
  }

  /** Trims and coerces line input into what the tax engine expects. */
  private static normaliseItems(items: RawInvoiceItem[]): NormalisedItem[] {
    return items.map((item) => ({
      productId: item.productId ?? null,
      name: item.name?.trim(),
      description: item.description?.trim() || null,
      hsnSacCode: item.hsnSacCode?.trim() || null,
      unit: item.unit?.trim() || 'PCS',
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      discountPercent: toNumber(item.discountPercent),
      taxRate: toNumber(item.taxRate)
    }));
  }

  /** Accepts a hand-typed number, then pushes the counter past it. */
  private static async useManualNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
    rawNumber: string,
    issueDate: Date
  ) {
    const number = rawNumber.trim();

    const clash = await tx.invoice.findUnique({
      where: { companyId_invoiceNumber: { companyId, invoiceNumber: number } },
      select: { id: true }
    });

    if (clash) {
      throw AppError.conflict(`Invoice number ${number} is already in use`);
    }

    const sequenceNo = NumberingService.extractSequenceNo(number);

    await NumberingService.reserveManualNumber(
      tx,
      companyId,
      DocumentType.INVOICE,
      sequenceNo,
      issueDate
    );

    return {
      number,
      sequenceNo,
      financialYear: financialYearOf(issueDate),
      periodKey: financialYearOf(issueDate)
    };
  }
}
