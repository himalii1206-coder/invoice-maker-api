import { Prisma, NumberResetMode, NotificationEvent } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';

/**
 * Per-business invoice settings: numbering rules, document defaults and
 * presentation options.
 */

export const invoiceSettingsSelect = {
  id: true,
  companyId: true,
  invoicePrefix: true,
  invoiceSuffix: true,
  quotationPrefix: true,
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
  fontFamily: true,
  tableStyle: true,
  signaturePosition: true,
  showHsnColumn: true,
  showDiscount: true,
  showBankDetails: true,
  showSignature: true,
  signatureUrl: true,
  footerNote: true,
  gstEnabled: true,
  pricesIncludeTax: true,
  enableReverseCharge: true,
  hsnRequiredOnProduct: true,
  customerCodePrefix: true,
  customerCreditDays: true,
  customerRequirePhone: true,
  customerRequireState: true,
  customerRequireGstin: true,
  productCodePrefix: true,
  defaultUnit: true,
  defaultDiscountMode: true,
  notifyEvents: true,
  notifyEmail: true,
  notifyInApp: true,
  notifyBrowser: true,
  enableRoundOff: true,
  autoMarkOverdue: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.InvoiceSettingsSelect;

export type InvoiceSettingsRecord = Prisma.InvoiceSettingsGetPayload<{
  select: typeof invoiceSettingsSelect;
}>;

export interface UpdateInvoiceSettingsInput {
  invoicePrefix?: string;
  invoiceSuffix?: string | null;
  quotationPrefix?: string;
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
  fontFamily?: string;
  tableStyle?: string;
  signaturePosition?: string;
  showHsnColumn?: boolean;
  showDiscount?: boolean;
  showBankDetails?: boolean;
  showSignature?: boolean;
  signatureUrl?: string | null;
  footerNote?: string | null;
  gstEnabled?: boolean;
  pricesIncludeTax?: boolean;
  enableReverseCharge?: boolean;
  hsnRequiredOnProduct?: boolean;
  customerCodePrefix?: string;
  customerCreditDays?: number;
  customerRequirePhone?: boolean;
  customerRequireState?: boolean;
  customerRequireGstin?: boolean;
  productCodePrefix?: string;
  defaultUnit?: string;
  defaultDiscountMode?: string;
  notifyEvents?: NotificationEvent[];
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  notifyBrowser?: boolean;
  enableRoundOff?: boolean;
  autoMarkOverdue?: boolean;
}

export class InvoiceSettingsService {
  /**
   * Loads settings for a business, lazily initialising them to defaults if
   * this is the first time they have been touched.
   */
  static async getOrCreate(
    companyId: string,
    client: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<InvoiceSettingsRecord> {
    const existing = await client.invoiceSettings.findUnique({
      where: { companyId },
      select: invoiceSettingsSelect
    });

    if (existing) return existing;

    const company = await client.company.findUnique({
      where: { id: companyId },
      select: { id: true }
    });

    if (!company) {
      throw AppError.notFound('No business profile found for this account');
    }

    return client.invoiceSettings.create({
      data: {
        companyId,
        invoicePrefix: 'INV',
        numberSeparator: '-',
        startNumber: 1,
        defaultTaxRate: 18,
        includeYearInNumber: true,
        resetMode: NumberResetMode.FINANCIAL_YEAR
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
      if (key in input && input[key] !== undefined) {
        (data as Record<string, unknown>)[key] = input[key];
      }
    };

    (
      [
        'invoicePrefix',
        'invoiceSuffix',
        'quotationPrefix',
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
        'fontFamily',
        'tableStyle',
        'signaturePosition',
        'showHsnColumn',
        'showDiscount',
        'showBankDetails',
        'showSignature',
        'signatureUrl',
        'footerNote',
        'gstEnabled',
        'pricesIncludeTax',
        'enableReverseCharge',
        'hsnRequiredOnProduct',
        'customerCodePrefix',
        'customerCreditDays',
        'customerRequirePhone',
        'customerRequireState',
        'customerRequireGstin',
        'productCodePrefix',
        'defaultUnit',
        'defaultDiscountMode',
        'notifyEvents',
        'notifyEmail',
        'notifyInApp',
        'notifyBrowser',
        'enableRoundOff',
        'autoMarkOverdue'
      ] as const
    ).forEach(assign);

    const updated = await prisma.invoiceSettings.update({
      where: { companyId },
      data,
      select: invoiceSettingsSelect
    });

    return updated;
  }
}
