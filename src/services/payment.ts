import { Prisma, PaymentMethod, InvoiceStatus, ActivityType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';
import { round2, toNumber } from '../utils/money.js';
import { startOfDay, endOfDay, today } from '../utils/date.js';
import { InvoiceService } from './invoice.js';
import { ActivityService } from './activity.js';

/**
 * Payments against invoices.
 *
 * A payment never writes the invoice's derived money itself. It inserts a row
 * and then asks `InvoiceService.syncState` to recompute the paid total, the
 * balance and the status from all payments and notes at once - so recording,
 * editing and deleting a payment all converge on the same answer, and a
 * half-applied write cannot leave a balance that disagrees with its payments.
 */

export interface CreatePaymentInput {
  amount: number;
  paymentDate?: string | Date;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string | null;
  notes?: string | null;
}

export type UpdatePaymentInput = Partial<CreatePaymentInput>;

export interface ListPaymentsQuery {
  page: number;
  limit: number;
  search?: string;
  invoiceId?: string;
  customerId?: string;
  paymentMethod?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
  sortBy: 'paymentDate' | 'amount' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

const paymentSelect = {
  id: true,
  invoiceId: true,
  amount: true,
  paymentDate: true,
  paymentMethod: true,
  referenceNumber: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      billingName: true,
      grandTotal: true,
      balanceDue: true,
      status: true,
      currency: true,
      customerId: true
    }
  }
} satisfies Prisma.PaymentSelect;

/** Statuses that can receive money. A draft has not been issued yet. */
const PAYABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID
];

export class PaymentService {
  static async list(companyId: string, query: ListPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = {
      companyId,
      ...(query.invoiceId && { invoiceId: query.invoiceId }),
      ...(query.customerId && { invoice: { customerId: query.customerId } }),
      ...(query.paymentMethod && { paymentMethod: query.paymentMethod }),
      ...((query.dateFrom || query.dateTo) && {
        paymentDate: {
          ...(query.dateFrom && { gte: startOfDay(query.dateFrom) }),
          ...(query.dateTo && { lte: endOfDay(query.dateTo) })
        }
      }),
      ...(query.search && {
        OR: [
          { referenceNumber: { contains: query.search, mode: 'insensitive' as const } },
          { notes: { contains: query.search, mode: 'insensitive' as const } },
          { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' as const } } },
          { invoice: { billingName: { contains: query.search, mode: 'insensitive' as const } } }
        ]
      })
    };

    const skip = (query.page - 1) * query.limit;

    const [payments, total, totals] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        select: paymentSelect,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take: query.limit
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({ where, _sum: { amount: true } })
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
      payments,
      meta,
      summary: { totalReceived: round2(totals._sum.amount ?? 0) }
    };
  }

  static async listForInvoice(companyId: string, invoiceId: string) {
    await this.getInvoice(companyId, invoiceId);

    return prisma.payment.findMany({
      where: { companyId, invoiceId },
      select: paymentSelect,
      orderBy: { paymentDate: 'desc' }
    });
  }

  /**
   * Records a payment.
   *
   * Overpayment is rejected rather than absorbed: an amount larger than the
   * outstanding balance is nearly always a typo, and silently accepting it
   * would leave the ledger claiming the customer is owed money back.
   */
  static async create(
    companyId: string,
    invoiceId: string,
    input: CreatePaymentInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ) {
    const invoice = await this.getInvoice(companyId, invoiceId);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('A cancelled invoice cannot receive payments');
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw AppError.badRequest('Mark the invoice as sent before recording a payment against it');
    }

    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw AppError.badRequest('This invoice cannot receive payments');
    }

    const amount = round2(input.amount);

    if (amount <= 0) {
      throw AppError.badRequest('Payment amount must be greater than zero');
    }

    const balanceDue = toNumber(invoice.balanceDue);

    if (balanceDue <= 0) {
      throw AppError.badRequest('This invoice is already settled in full');
    }

    if (amount > balanceDue) {
      throw AppError.badRequest(
        `Payment cannot exceed the outstanding balance of ${balanceDue.toFixed(2)}`
      );
    }

    const paymentDate = startOfDay(input.paymentDate ?? new Date());

    if (paymentDate > today()) {
      throw AppError.badRequest('Payment date cannot be in the future');
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          companyId,
          invoiceId,
          amount,
          paymentDate,
          paymentMethod: input.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
          referenceNumber: input.referenceNumber ?? null,
          notes: input.notes ?? null
        },
        select: paymentSelect
      });

      await InvoiceService.syncState(invoiceId, tx);

      await ActivityService.log(
        {
          companyId,
          invoiceId,
          userId: context.userId,
          action: ActivityType.PAYMENT_RECORDED,
          description: `Payment of ${amount.toFixed(2)} recorded via ${
            input.paymentMethod ?? PaymentMethod.BANK_TRANSFER
          }`,
          metadata: {
            amount,
            paymentMethod: input.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
            referenceNumber: input.referenceNumber ?? null
          },
          ipAddress: context.ipAddress
        },
        tx
      );

      return created;
    });

    // Settling the invoice makes any pending chase-ups pointless.
    await this.cancelRemindersIfSettled(companyId, invoiceId);

    return payment;
  }

  static async update(
    companyId: string,
    paymentId: string,
    input: UpdatePaymentInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ) {
    const existing = await prisma.payment.findFirst({
      where: { id: paymentId, companyId },
      select: { id: true, invoiceId: true, amount: true }
    });

    if (!existing) throw AppError.notFound('Payment not found');

    const invoice = await this.getInvoice(companyId, existing.invoiceId);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('Payments on a cancelled invoice cannot be edited');
    }

    const data: Prisma.PaymentUpdateInput = {};

    if (input.amount !== undefined) {
      const amount = round2(input.amount);

      if (amount <= 0) {
        throw AppError.badRequest('Payment amount must be greater than zero');
      }

      // The balance already includes this payment, so the room available is the
      // current balance plus whatever this row is currently contributing.
      const available = round2(toNumber(invoice.balanceDue) + toNumber(existing.amount));

      if (amount > available) {
        throw AppError.badRequest(
          `Payment cannot exceed the outstanding balance of ${available.toFixed(2)}`
        );
      }

      data.amount = amount;
    }

    if (input.paymentDate !== undefined) {
      const paymentDate = startOfDay(input.paymentDate);
      if (paymentDate > today()) {
        throw AppError.badRequest('Payment date cannot be in the future');
      }
      data.paymentDate = paymentDate;
    }

    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
    if ('referenceNumber' in input) data.referenceNumber = input.referenceNumber ?? null;
    if ('notes' in input) data.notes = input.notes ?? null;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payment.update({
        where: { id: paymentId },
        data,
        select: paymentSelect
      });

      await InvoiceService.syncState(existing.invoiceId, tx);

      await ActivityService.log(
        {
          companyId,
          invoiceId: existing.invoiceId,
          userId: context.userId,
          action: ActivityType.PAYMENT_RECORDED,
          description: `Payment updated from ${toNumber(existing.amount).toFixed(2)} to ${toNumber(
            row.amount
          ).toFixed(2)}`,
          metadata: { paymentId, from: toNumber(existing.amount), to: toNumber(row.amount) },
          ipAddress: context.ipAddress
        },
        tx
      );

      return row;
    });

    await this.cancelRemindersIfSettled(companyId, existing.invoiceId);

    return updated;
  }

  static async remove(
    companyId: string,
    paymentId: string,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<{ id: string }> {
    const existing = await prisma.payment.findFirst({
      where: { id: paymentId, companyId },
      select: { id: true, invoiceId: true, amount: true, referenceNumber: true }
    });

    if (!existing) throw AppError.notFound('Payment not found');

    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });

      // Removing money may reopen the invoice, so the status has to be re-derived.
      await InvoiceService.syncState(existing.invoiceId, tx);

      await ActivityService.log(
        {
          companyId,
          invoiceId: existing.invoiceId,
          userId: context.userId,
          action: ActivityType.PAYMENT_DELETED,
          description: `Payment of ${toNumber(existing.amount).toFixed(2)} deleted`,
          metadata: {
            amount: toNumber(existing.amount),
            referenceNumber: existing.referenceNumber
          },
          ipAddress: context.ipAddress
        },
        tx
      );
    });

    return { id: paymentId };
  }

  /** Receipts collected per day / method - feeds the payments report. */
  static async summary(
    companyId: string,
    options: { dateFrom?: string; dateTo?: string } = {}
  ) {
    const where: Prisma.PaymentWhereInput = {
      companyId,
      ...((options.dateFrom || options.dateTo) && {
        paymentDate: {
          ...(options.dateFrom && { gte: startOfDay(options.dateFrom) }),
          ...(options.dateTo && { lte: endOfDay(options.dateTo) })
        }
      })
    };

    const [byMethod, totals] = await Promise.all([
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { amount: true },
        _count: { _all: true }
      }),
      prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true })
    ]);

    return {
      totalReceived: round2(totals._sum.amount ?? 0),
      paymentCount: totals._count,
      byMethod: Object.values(PaymentMethod).map((method) => {
        const row = byMethod.find((entry) => entry.paymentMethod === method);
        return {
          paymentMethod: method,
          amount: round2(row?._sum.amount ?? 0),
          count: row?._count._all ?? 0
        };
      })
    };
  }

  private static async getInvoice(companyId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        grandTotal: true,
        balanceDue: true,
        amountPaid: true,
        currency: true
      }
    });

    if (!invoice) throw AppError.notFound('Invoice not found');
    return invoice;
  }

  private static async cancelRemindersIfSettled(
    companyId: string,
    invoiceId: string
  ): Promise<void> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { balanceDue: true }
    });

    if (invoice && toNumber(invoice.balanceDue) <= 0) {
      await prisma.paymentReminder.updateMany({
        where: { invoiceId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' }
      });
    }
  }
}
