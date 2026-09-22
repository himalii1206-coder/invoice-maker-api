import { Prisma, NotificationEvent, MemberStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { InvoiceSettingsService } from './invoiceSettings.js';
import { sendEmail, renderEmailShell, escapeHtml } from '../utils/email.js';
import { config } from '../config/index.js';
import { PaginationMeta } from '../types/index.js';

/**
 * Business-event notifications.
 *
 * Which events fire, and down which channels, is configured per business in
 * settings - this service is the single place that reads those preferences, so
 * turning an event off in Settings genuinely stops it everywhere.
 *
 * Like the activity trail, `notify` never throws: a notification is a courtesy
 * on top of an operation that already succeeded, and must not be able to fail
 * the invoice that triggered it.
 */

export const notificationSelect = {
  id: true,
  event: true,
  title: true,
  body: true,
  link: true,
  isRead: true,
  readAt: true,
  createdAt: true
} satisfies Prisma.NotificationSelect;

export interface NotifyInput {
  companyId: string;
  event: NotificationEvent;
  title: string;
  body?: string;
  link?: string;
  /**
   * The person who caused the event, recorded for context.
   *
   * They are deliberately *not* excluded as a recipient. In a one-person
   * business the actor is the only person there, so skipping them would mean
   * that switching "Invoice Created" on in Settings did nothing at all. The
   * tray doubles as the business activity feed, and any event that is too
   * noisy can be turned off individually.
   */
  actorUserId?: string | null;
}

export class NotificationService {
  /** Everyone who can see this business: the owner plus active members. */
  private static async recipients(companyId: string): Promise<
    Array<{ id: string; email: string; firstName: string }>
  > {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        user: { select: { id: true, email: true, firstName: true, isActive: true } },
        members: {
          where: { status: MemberStatus.ACTIVE, userId: { not: null } },
          select: {
            user: { select: { id: true, email: true, firstName: true, isActive: true } }
          }
        }
      }
    });

    if (!company) return [];

    const people = [company.user, ...company.members.map((m) => m.user)].filter(
      (u): u is { id: string; email: string; firstName: string; isActive: boolean } =>
        Boolean(u) && u!.isActive
    );

    // The owner can also hold a membership row; de-duplicate by id.
    return Array.from(new Map(people.map((u) => [u.id, u])).values());
  }

  static async notify(input: NotifyInput): Promise<void> {
    try {
      const settings = await InvoiceSettingsService.getOrCreate(input.companyId);

      if (!settings.notifyEvents.includes(input.event)) return;
      if (!settings.notifyInApp && !settings.notifyEmail) return;

      const people = await this.recipients(input.companyId);

      if (people.length === 0) return;

      if (settings.notifyInApp) {
        await prisma.notification.createMany({
          data: people.map((person) => ({
            companyId: input.companyId,
            userId: person.id,
            event: input.event,
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null
          }))
        });
      }

      if (settings.notifyEmail) {
        const html = renderEmailShell({
          heading: input.title,
          accent: settings.themeColor,
          body: `<p style="margin:0 0 12px;">${escapeHtml(input.body ?? input.title)}</p>`,
          ...(input.link
            ? { cta: { label: 'Open in dashboard', url: `${config.appUrl}${input.link}` } }
            : {}),
          footer: 'You are receiving this because event alerts are enabled in Settings → Notifications.'
        });

        // Fire-and-forget: the recipients are internal staff, and a slow SMTP
        // server must not hold up the request that triggered this.
        void Promise.all(
          people.map((person) =>
            sendEmail({ to: person.email, subject: input.title, html })
          )
        ).catch((error) => console.error('Notification email failed:', error));
      }
    } catch (error) {
      console.error('Notification dispatch failed:', error);
    }
  }

  static async list(
    userId: string,
    query: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ): Promise<{
    data: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>[];
    meta: PaginationMeta;
    unreadCount: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { isRead: false } : {})
    };

    const [data, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } })
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      unreadCount
    };
  }

  static async markRead(userId: string, notificationId: string): Promise<void> {
    // Scoped by userId so one member cannot clear another's notifications.
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() }
    });
  }

  static async markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });
    return result.count;
  }

  static async clear(userId: string): Promise<number> {
    const result = await prisma.notification.deleteMany({ where: { userId } });
    return result.count;
  }
}
