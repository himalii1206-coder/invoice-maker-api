import { Prisma, ActivityType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { PaginationMeta } from '../types/index.js';

/**
 * Invoice activity trail.
 *
 * An invoice is a financial record, so every change to one needs to be
 * explainable after the fact: who sent it, when a payment landed, why it was
 * cancelled. Writes go through `log`, which never throws - a failed audit
 * insert must not roll back the business operation that succeeded, and is far
 * better reported than retried.
 */

export const activitySelect = {
  id: true,
  invoiceId: true,
  action: true,
  description: true,
  metadata: true,
  createdAt: true,
  user: {
    select: { id: true, firstName: true, lastName: true, email: true }
  }
} satisfies Prisma.InvoiceActivitySelect;

export interface LogActivityInput {
  companyId: string;
  invoiceId: string;
  userId?: string | null;
  action: ActivityType;
  description: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

export class ActivityService {
  /**
   * Records one activity entry.
   *
   * Pass `client` to join the caller's transaction when the trail must commit
   * with the change it describes; omit it for after-the-fact events such as a
   * PDF download, where a failure should not surface to the user.
   */
  static async log(
    input: LogActivityInput,
    client: Prisma.TransactionClient = prisma
  ): Promise<void> {
    try {
      await client.invoiceActivity.create({
        data: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          userId: input.userId ?? null,
          action: input.action,
          description: input.description,
          ...(input.metadata !== undefined && { metadata: input.metadata }),
          ipAddress: input.ipAddress ?? null
        }
      });
    } catch (error) {
      // Audit trail is best-effort; losing an entry must not fail the request.
      console.error('Failed to record invoice activity:', error);
    }
  }

  /** Writes several entries at once, e.g. when a bulk action touches many invoices. */
  static async logMany(
    entries: LogActivityInput[],
    client: Prisma.TransactionClient = prisma
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      await client.invoiceActivity.createMany({
        data: entries.map((entry) => ({
          companyId: entry.companyId,
          invoiceId: entry.invoiceId,
          userId: entry.userId ?? null,
          action: entry.action,
          description: entry.description,
          ...(entry.metadata !== undefined && { metadata: entry.metadata }),
          ipAddress: entry.ipAddress ?? null
        }))
      });
    } catch (error) {
      console.error('Failed to record invoice activities:', error);
    }
  }

  static async listForInvoice(
    companyId: string,
    invoiceId: string,
    query: { page: number; limit: number }
  ) {
    const where: Prisma.InvoiceActivityWhereInput = { companyId, invoiceId };
    const skip = (query.page - 1) * query.limit;

    const [activities, total] = await prisma.$transaction([
      prisma.invoiceActivity.findMany({
        where,
        select: activitySelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit
      }),
      prisma.invoiceActivity.count({ where })
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

    return { activities, meta };
  }

  /** Recent activity across the whole business - drives the dashboard feed. */
  static async listForCompany(companyId: string, limit = 15) {
    return prisma.invoiceActivity.findMany({
      where: { companyId },
      select: {
        ...activitySelect,
        invoice: { select: { id: true, invoiceNumber: true, billingName: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }
}
