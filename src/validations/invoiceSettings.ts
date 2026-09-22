import { z } from 'zod';
import { NumberResetMode, NotificationEvent } from '@prisma/client';

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === undefined ? undefined : v === '' || v === null ? null : v));

/** Codes are used to build identifiers like CUST-0001, so keep them terse. */
const codePrefix = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(8, `${label} must be at most 8 characters`)
    .regex(/^[A-Za-z0-9]+$/, `${label} can only contain letters and numbers`)
    .toUpperCase()
    .optional();

/** Day offsets for reminders; de-duplicated and capped so a save cannot spam. */
const dayOffsets = z
  .array(z.coerce.number().int().min(0, 'Days cannot be negative').max(180, 'Days cannot exceed 180'))
  .max(6, 'At most 6 reminder offsets can be configured')
  .transform((values) => Array.from(new Set(values)).sort((a, b) => a - b));

export const updateInvoiceSettingsSchema = z.object({
  body: z
    .object({
      invoicePrefix: z
        .string()
        .trim()
        .min(1, 'Invoice prefix is required')
        .max(12, 'Invoice prefix must be at most 12 characters')
        .regex(/^[A-Za-z0-9_\-\/]+$/, 'Invoice prefix can only contain letters, numbers, hyphens or slashes')
        .optional(),
      invoiceSuffix: optionalText(12, 'Invoice suffix'),
      creditNotePrefix: z
        .string()
        .trim()
        .min(1, 'Credit note prefix is required')
        .max(12, 'Credit note prefix must be at most 12 characters')
        .regex(/^[A-Za-z0-9_\-\/]+$/, 'Credit note prefix can only contain letters, numbers, hyphens or slashes')
        .optional(),
      debitNotePrefix: z
        .string()
        .trim()
        .min(1, 'Debit note prefix is required')
        .max(12, 'Debit note prefix must be at most 12 characters')
        .regex(/^[A-Za-z0-9_\-\/]+$/, 'Debit note prefix can only contain letters, numbers, hyphens or slashes')
        .optional(),
      numberSeparator: z
        .enum(['-', '/', '_', ''], {
          errorMap: () => ({ message: 'Separator must be one of -, /, _ or none' })
        })
        .optional(),
      numberPadding: z.coerce
        .number()
        .int()
        .min(1, 'Padding must be at least 1')
        .max(10, 'Padding cannot exceed 10')
        .optional(),
      startNumber: z.coerce
        .number()
        .int()
        .min(1, 'Starting number must be 1 or greater')
        .max(99999999, 'Starting number is too large')
        .optional(),
      resetMode: z.nativeEnum(NumberResetMode).optional(),
      includeYearInNumber: z.boolean().optional(),

      defaultDueDays: z.coerce
        .number()
        .int()
        .min(0, 'Due days cannot be negative')
        .max(365, 'Due days cannot exceed 365')
        .optional(),
      defaultTaxRate: z.coerce
        .number()
        .min(0, 'Tax rate cannot be negative')
        .max(100, 'Tax rate cannot exceed 100')
        .optional(),
      defaultCurrency: z
        .string()
        .trim()
        .length(3, 'Currency must be a 3 letter code')
        .toUpperCase()
        .optional(),
      defaultTerms: optionalText(2000, 'Default terms'),
      defaultNotes: optionalText(2000, 'Default notes'),

      themeColor: z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Theme colour must be a hex value like #7c4a27')
        .optional(),
      template: z.enum(['classic', 'modern', 'minimal']).optional(),
      // Only the PDF core families are offered: anything else would need a font
      // file shipped with the server, and would silently fall back otherwise.
      fontFamily: z.enum(['HELVETICA', 'TIMES', 'COURIER']).optional(),
      tableStyle: z.enum(['grid', 'minimal', 'striped']).optional(),
      signaturePosition: z.enum(['left', 'right']).optional(),
      showHsnColumn: z.boolean().optional(),
      showDiscount: z.boolean().optional(),
      showBankDetails: z.boolean().optional(),
      showSignature: z.boolean().optional(),
      signatureUrl: optionalText(500, 'Signature URL'),
      footerNote: optionalText(300, 'Footer note'),

      gstEnabled: z.boolean().optional(),
      pricesIncludeTax: z.boolean().optional(),
      enableReverseCharge: z.boolean().optional(),
      hsnRequiredOnProduct: z.boolean().optional(),

      customerCodePrefix: codePrefix('Customer code prefix'),
      customerCreditDays: z.coerce
        .number()
        .int()
        .min(0, 'Credit period cannot be negative')
        .max(365, 'Credit period cannot exceed 365 days')
        .optional(),
      customerRequirePhone: z.boolean().optional(),
      customerRequireState: z.boolean().optional(),
      customerRequireGstin: z.boolean().optional(),

      productCodePrefix: codePrefix('Product code prefix'),
      defaultUnit: z
        .string()
        .trim()
        .min(1, 'Default unit is required')
        .max(12, 'Default unit must be at most 12 characters')
        .toUpperCase()
        .optional(),
      defaultDiscountMode: z.enum(['PERCENT', 'FIXED']).optional(),

      notifyEvents: z
        .array(z.nativeEnum(NotificationEvent))
        .max(20, 'Too many notification events')
        .transform((values) => Array.from(new Set(values)))
        .optional(),
      notifyEmail: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      notifyBrowser: z.boolean().optional(),

      enableRoundOff: z.boolean().optional(),
      autoMarkOverdue: z.boolean().optional(),

      remindersEnabled: z.boolean().optional(),
      remindBeforeDays: dayOffsets.optional(),
      remindOnDueDate: z.boolean().optional(),
      remindAfterDays: dayOffsets.optional(),
      reminderCcEmails: optionalText(300, 'Reminder CC emails'),
      reminderSubject: optionalText(200, 'Reminder subject'),
      reminderBody: optionalText(2000, 'Reminder body')
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one setting must be provided to update'
    })
});

export const sendInvoiceEmailSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid invoice id') }),
  body: z.object({
    to: z.string().trim().email('Enter a valid recipient email').optional(),
    cc: z
      .string()
      .trim()
      .max(300, 'CC list is too long')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? undefined : v)),
    subject: z.string().trim().max(200, 'Subject is too long').optional(),
    message: z.string().trim().max(2000, 'Message is too long').optional(),
    attachPdf: z.boolean().optional(),
    markAsSent: z.boolean().optional()
  })
});
