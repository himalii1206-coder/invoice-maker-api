import { ActivityType, InvoiceStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/error.js';
import {
  escapeHtml,
  isEmailConfigured,
  renderDetailRows,
  renderEmailShell,
  sendEmail
} from '../utils/email.js';
import { formatMoney, toNumber } from '../utils/money.js';
import { daysBetween, formatDocumentDate, today } from '../utils/date.js';
import { InvoiceService, InvoiceDetail } from './invoice.js';
import { InvoiceSettingsService } from './invoiceSettings.js';
import { PdfService } from './pdf.js';
import { ActivityService } from './activity.js';

/**
 * Sending invoices and reminders by email.
 *
 * Templating lives here rather than in the reminder scheduler so a manual send
 * and an automated chase-up produce the same message. The PDF is attached
 * rather than linked: the recipient is usually outside the system and has no
 * account to log in with.
 */

export interface SendInvoiceEmailInput {
  to?: string;
  cc?: string;
  subject?: string;
  message?: string;
  attachPdf?: boolean;
  /** Moves a draft to SENT once the mail actually goes out. */
  markAsSent?: boolean;
}

export interface SendInvoiceEmailResult {
  sent: boolean;
  recipient: string;
  messageId?: string;
  error?: string;
}

export class InvoiceEmailService {
  /** Sends an invoice to its customer, with the PDF attached by default. */
  static async sendInvoice(
    companyId: string,
    invoiceId: string,
    input: SendInvoiceEmailInput = {},
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<SendInvoiceEmailResult> {
    if (!isEmailConfigured()) {
      throw AppError.badRequest(
        'Email is not configured on this server. Add SMTP credentials to send invoices.'
      );
    }

    const [invoice, company, settings] = await Promise.all([
      InvoiceService.getById(companyId, invoiceId),
      InvoiceService.getCompanyProfile(companyId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('A cancelled invoice cannot be emailed');
    }

    const recipient = (input.to ?? invoice.billingEmail ?? invoice.customer.email ?? '').trim();

    if (!recipient) {
      throw AppError.badRequest(
        'This customer has no email address. Add one, or enter a recipient for this send.'
      );
    }

    const attachments = input.attachPdf === false
      ? undefined
      : await this.buildAttachment(companyId, invoiceId);

    const subject =
      input.subject?.trim() ||
      `Invoice ${invoice.invoiceNumber} from ${company.name}`;

    const result = await sendEmail({
      to: recipient,
      cc: this.splitEmails(input.cc),
      replyTo: company.email ?? undefined,
      fromName: company.name,
      subject,
      html: this.renderInvoiceBody(invoice, company, settings.themeColor, input.message),
      attachments
    });

    await ActivityService.log({
      companyId,
      invoiceId,
      userId: context.userId,
      action: ActivityType.EMAIL_SENT,
      description: result.sent
        ? `Invoice emailed to ${recipient}`
        : `Invoice email to ${recipient} failed`,
      metadata: {
        recipient,
        subject,
        success: result.sent,
        ...(result.error && { error: result.error })
      },
      ipAddress: context.ipAddress
    });

    if (!result.sent) {
      throw AppError.badRequest(result.error ?? 'The invoice email could not be sent');
    }

    // Only promote a draft once the message has actually left.
    if (input.markAsSent !== false && invoice.status === InvoiceStatus.DRAFT) {
      await InvoiceService.setStatus(companyId, invoiceId, InvoiceStatus.SENT, context);
    } else if (!invoice.sentAt) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { sentAt: new Date() } });
    }

    return { sent: true, recipient, messageId: result.messageId };
  }

  /**
   * Sends a payment reminder. Kept separate from `sendInvoice` because the
   * framing differs: a reminder leads with what is owed and how late it is.
   */
  static async sendReminder(
    companyId: string,
    invoiceId: string,
    input: { to?: string; cc?: string; subject?: string; message?: string; attachPdf?: boolean } = {},
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<SendInvoiceEmailResult> {
    if (!isEmailConfigured()) {
      throw AppError.badRequest(
        'Email is not configured on this server. Add SMTP credentials to send reminders.'
      );
    }

    const [invoice, company, settings] = await Promise.all([
      InvoiceService.getById(companyId, invoiceId),
      InvoiceService.getCompanyProfile(companyId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw AppError.badRequest('A cancelled invoice cannot be chased for payment');
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw AppError.badRequest('Send the invoice before reminding the customer about it');
    }

    if (toNumber(invoice.balanceDue) <= 0) {
      throw AppError.badRequest('This invoice is already settled in full');
    }

    const recipient = (
      input.to ??
      invoice.billingEmail ??
      invoice.customer.email ??
      ''
    ).trim();

    if (!recipient) {
      throw AppError.badRequest('This customer has no email address to remind');
    }

    const overdueBy = daysBetween(invoice.dueDate, today());

    const subject =
      input.subject?.trim() ||
      (overdueBy > 0
        ? `Overdue: Invoice ${invoice.invoiceNumber} from ${company.name}`
        : `Payment reminder: Invoice ${invoice.invoiceNumber} from ${company.name}`);

    const attachments = input.attachPdf
      ? await this.buildAttachment(companyId, invoiceId)
      : undefined;

    const result = await sendEmail({
      to: recipient,
      cc: this.splitEmails(input.cc),
      replyTo: company.email ?? undefined,
      fromName: company.name,
      subject,
      html: this.renderReminderBody(
        invoice,
        company,
        settings.themeColor,
        overdueBy,
        input.message
      ),
      attachments
    });

    await ActivityService.log({
      companyId,
      invoiceId,
      userId: context.userId,
      action: ActivityType.REMINDER_SENT,
      description: result.sent
        ? `Payment reminder emailed to ${recipient}`
        : `Payment reminder to ${recipient} failed`,
      metadata: {
        recipient,
        overdueBy,
        balanceDue: toNumber(invoice.balanceDue),
        success: result.sent,
        ...(result.error && { error: result.error })
      },
      ipAddress: context.ipAddress
    });

    if (!result.sent) {
      throw AppError.badRequest(result.error ?? 'The reminder email could not be sent');
    }

    return { sent: true, recipient, messageId: result.messageId };
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  private static renderInvoiceBody(
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    accent: string,
    customMessage?: string
  ): string {
    const rows: Array<[string, string]> = [
      ['Invoice Number', invoice.invoiceNumber],
      ['Invoice Date', formatDocumentDate(invoice.issueDate)],
      ['Due Date', formatDocumentDate(invoice.dueDate)],
      ['Amount', formatMoney(invoice.grandTotal, invoice.currency)]
    ];

    if (toNumber(invoice.amountPaid) > 0) {
      rows.push(['Amount Paid', formatMoney(invoice.amountPaid, invoice.currency)]);
      rows.push(['Balance Due', formatMoney(invoice.balanceDue, invoice.currency)]);
    }

    const intro = customMessage?.trim()
      ? `<p style="margin:0 0 12px;">${escapeHtml(customMessage).replace(/\n/g, '<br />')}</p>`
      : `<p style="margin:0 0 12px;">Dear ${escapeHtml(invoice.billingName)},</p>
         <p style="margin:0 0 12px;">Please find attached invoice <strong>${escapeHtml(
           invoice.invoiceNumber
         )}</strong> for ${formatMoney(invoice.grandTotal, invoice.currency)}, due on ${formatDocumentDate(
           invoice.dueDate
         )}.</p>`;

    return renderEmailShell({
      heading: `Invoice ${invoice.invoiceNumber}`,
      accent,
      body: `${intro}${renderDetailRows(rows)}
        <p style="margin:16px 0 0;font-size:13px;color:#6b5a4e;">Thank you for your business.</p>
        <p style="margin:4px 0 0;font-size:13px;color:#2b180d;font-weight:600;">${escapeHtml(
          company.name
        )}</p>`,
      footer: `${escapeHtml(company.name)}${
        company.email ? ` &nbsp;•&nbsp; ${escapeHtml(company.email)}` : ''
      }${company.phone ? ` &nbsp;•&nbsp; ${escapeHtml(company.phone)}` : ''}`
    });
  }

  private static renderReminderBody(
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    accent: string,
    overdueBy: number,
    customMessage?: string | null
  ): string {
    const rows: Array<[string, string]> = [
      ['Invoice Number', invoice.invoiceNumber],
      ['Invoice Date', formatDocumentDate(invoice.issueDate)],
      ['Due Date', formatDocumentDate(invoice.dueDate)],
      ['Invoice Total', formatMoney(invoice.grandTotal, invoice.currency)],
      ['Amount Paid', formatMoney(invoice.amountPaid, invoice.currency)],
      ['Balance Due', formatMoney(invoice.balanceDue, invoice.currency)]
    ];

    const timing =
      overdueBy > 0
        ? `is now <strong>${overdueBy} day${overdueBy === 1 ? '' : 's'} overdue</strong>`
        : overdueBy === 0
          ? 'is <strong>due today</strong>'
          : `is due in <strong>${Math.abs(overdueBy)} day${
              Math.abs(overdueBy) === 1 ? '' : 's'
            }</strong>`;

    const intro = customMessage?.trim()
      ? `<p style="margin:0 0 12px;">${escapeHtml(customMessage).replace(/\n/g, '<br />')}</p>`
      : `<p style="margin:0 0 12px;">Dear ${escapeHtml(invoice.billingName)},</p>
         <p style="margin:0 0 12px;">This is a friendly reminder that invoice <strong>${escapeHtml(
           invoice.invoiceNumber
         )}</strong> for ${formatMoney(
           invoice.balanceDue,
           invoice.currency
         )} ${timing}.</p>`;

    return renderEmailShell({
      heading: overdueBy > 0 ? 'Payment Overdue' : 'Payment Reminder',
      accent: overdueBy > 0 ? '#b91c1c' : accent,
      body: `${intro}${renderDetailRows(rows)}
        <p style="margin:16px 0 0;font-size:13px;color:#6b5a4e;">If you have already sent this payment, please ignore this message.</p>
        <p style="margin:4px 0 0;font-size:13px;color:#2b180d;font-weight:600;">${escapeHtml(
          company.name
        )}</p>`,
      footer: `${escapeHtml(company.name)}${
        company.email ? ` &nbsp;•&nbsp; ${escapeHtml(company.email)}` : ''
      }`
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private static async buildAttachment(companyId: string, invoiceId: string) {
    const { buffer, fileName } = await PdfService.renderInvoice(companyId, invoiceId);
    return [{ filename: fileName, content: buffer, contentType: 'application/pdf' }];
  }

  /** Accepts "a@b.com, c@d.com" from a single form field. */
  private static splitEmails(value?: string | null): string[] | undefined {
    if (!value) return undefined;

    const list = value
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return list.length ? list : undefined;
  }

  /** Exposed so the UI can hide email actions when the server cannot send. */
  static status() {
    return { configured: isEmailConfigured(), appUrl: config.appUrl };
  }
}
