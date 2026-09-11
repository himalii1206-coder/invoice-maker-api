import { Prisma, NumberResetMode } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';

/**
 * Per-business invoice settings: numbering rules, document defaults and
 * presentation options.
 *
 * `Company` still carries the original `invoicePrefix` / `nextInvoiceNumber`
 * columns from before this module existed. They remain the source of truth for
 * the auth payload, so the first read here seeds the settings row from them -
 * an existing business keeps numbering where it left off instead of jumping
 * back to 1.
 */

export const invoiceSettingsSelect = {
  id: true,
  companyId: true,
  invoicePrefix: true,
  invoiceSuffix: true,
  creditNotePrefix: true,
  debitNotePrefix: true,
  numberSeparator: true,
  numberPadding: true,
  startNumber: true,
  resetMode: true,
  includeYearInNumber: true,
  defaultDueDays: true,
  defaultTaxRate: true,
  defaultCurrency: true,
  defaultTerms: true,
  defaultNotes: true,
  themeColor: true,
  template: true,
  showHsnColumn: true,
  showDiscount: true,
  showBankDetails: true,
  showSignature: true,
  signatureUrl: true,
  footerNote: true,
  enableRoundOff: true,
  autoMarkOverdue: true,
  remindersEnabled: true,
  remindBeforeDays: true,
  remindOnDueDate: true,
  remindAfterDays: true,
  reminderCcEmails: true,
  reminderSubject: true,
  reminderBody: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.InvoiceSettingsSelect;

export type InvoiceSettingsRecord = Prisma.InvoiceSettingsGetPayload<{
  select: typeof invoiceSettingsSelect;
}>;

export interface UpdateInvoiceSettingsInput {
  invoicePrefix?: string;
  invoiceSuffix?: string | null;
  creditNotePrefix?: string;
  debitNotePrefix?: string;
  numberSeparator?: string;
  numberPadding?: number;
  startNumber?: number;
  resetMode?: NumberResetMode;
  includeYearInNumber?: boolean;
  defaultDueDays?: number;
  defaultTaxRate?: number;
  defaultCurrency?: string;
  defaultTerms?: string | null;
  defaultNotes?: string | null;
  themeColor?: string;
  template?: string;
  showHsnColumn?: boolean;
  showDiscount?: boolean;
  showBankDetails?: boolean;
  showSignature?: boolean;
  signatureUrl?: string | null;
  footerNote?: string | null;
  enableRoundOff?: boolean;
  autoMarkOverdue?: boolean;
  remindersEnabled?: boolean;
  remindBeforeDays?: number[];
  remindOnDueDate?: boolean;
  remindAfterDays?: number[];
  reminderCcEmails?: string | null;
  reminderSubject?: string | null;
  reminderBody?: string | null;
}

/** Trailing punctuation in the legacy prefix is the separator, not the prefix. */
const splitLegacyPrefix = (raw: string): { prefix: string; separator: string } => {
  const match = raw.match(/^(.*?)([-/_\s])?$/);
  const prefix = (match?.[1] ?? raw).trim();
  const separator = match?.[2] ?? '-';

  return {
    prefix: prefix || 'INV',
    separator: separator.trim() === '' ? '-' : separator
  };
};

export class InvoiceSettingsService {
  /**
   * Returns the settings row, creating it on first use.
   *
   * Runs inside the caller's transaction when one is passed, so numbering can
   * read settings and allocate a number atomically.
   */
  static async getOrCreate(
    companyId: string,
    client: Prisma.TransactionClient = prisma
  ): Promise<InvoiceSettingsRecord> {
    const existing = await client.invoiceSettings.findUnique({
      where: { companyId },
      select: invoiceSettingsSelect
    });

    if (existing) return existing;

    const company = await client.company.findUnique({
      where: { id: companyId },
      select: { invoicePrefix: true, nextInvoiceNumber: true, defaultTaxRate: true }
    });

    if (!company) {
      throw AppError.notFound('No business profile found for this account');
    }

    const { prefix, separator } = splitLegacyPrefix(company.invoicePrefix ?? 'INV-');

    // A business that was already numbering from 1001 must not restart at 1.
    const startNumber = Math.max(1, company.nextInvoiceNumber ?? 1);

    return client.invoiceSettings.create({
      data: {
        companyId,
        invoicePrefix: prefix,
        numberSeparator: separator,
        startNumber,
        defaultTaxRate: company.defaultTaxRate ?? 18,
        // Pre-existing numbers had no year segment; keep them comparable.
        includeYearInNumber: false,
        resetMode: NumberResetMode.NEVER
      },
      select: invoiceSettingsSelect
    });
  }

  static async get(companyId: string): Promise<InvoiceSettingsRecord> {
    return this.getOrCreate(companyId);
  }

  static async update(
    companyId: string,
    input: UpdateInvoiceSettingsInput
  ): Promise<InvoiceSettingsRecord> {
    await this.getOrCreate(companyId);

    // Only touch keys the caller actually sent, so a partial save never wipes
    // fields it did not mention.
    const data: Prisma.InvoiceSettingsUpdateInput = {};
    const assign = <K extends keyof UpdateInvoiceSettingsInput>(key: K) => {
      if (key in input) {
        (data as Record<string, unknown>)[key] = input[key];
      }
    };

    (
      [
        'invoicePrefix',
        'invoiceSuffix',
        'creditNotePrefix',
        'debitNotePrefix',
        'numberSeparator',
        'numberPadding',
        'startNumber',
        'resetMode',
        'includeYearInNumber',
        'defaultDueDays',
        'defaultTaxRate',
        'defaultCurrency',
        'defaultTerms',
        'defaultNotes',
        'themeColor',
        'template',
        'showHsnColumn',
        'showDiscount',
        'showBankDetails',
        'showSignature',
        'signatureUrl',
        'footerNote',
        'enableRoundOff',
        'autoMarkOverdue',
        'remindersEnabled',
        'remindBeforeDays',
        'remindOnDueDate',
        'remindAfterDays',
        'reminderCcEmails',
        'reminderSubject',
        'reminderBody'
      ] as const
    ).forEach(assign);

    const updated = await prisma.invoiceSettings.update({
      where: { companyId },
      data,
      select: invoiceSettingsSelect
    });

    // Keep the legacy company columns aligned; the auth payload still reads them.
    if (input.invoicePrefix !== undefined || input.numberSeparator !== undefined) {
      await prisma.company.update({
        where: { id: companyId },
        data: { invoicePrefix: `${updated.invoicePrefix}${updated.numberSeparator}` }
      });
    }

    return updated;
  }
}
