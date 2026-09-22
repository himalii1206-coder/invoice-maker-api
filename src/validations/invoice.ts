import { z } from 'zod';
import { InvoiceStatus } from '@prisma/client';

/**
 * Invoice request schemas.
 *
 * Amounts are deliberately absent from every input schema: totals, tax and
 * balances are computed server-side from the line items, so accepting them
 * from a client would only create a way for the two to disagree.
 */

const HSN_REGEX = /^[0-9]{4,8}$/;

/** Turns "" or null into undefined so optional text fields can be cleared from a form. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === null || v === undefined ? undefined : v));

/** Accepts an ISO string or a date-only value from a native date input. */
const dateField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), `${label} must be a valid date`);

const optionalDateField = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((value) => !value || !Number.isNaN(new Date(value).getTime()), `${label} must be a valid date`)
    .transform((v) => (v ? v : undefined));

const uuid = (label: string) => z.string().uuid(`Invalid ${label}`);

export const invoiceItemSchema = z.object({
  productId: z.string().uuid('Invalid product id').nullish(),
  name: z
    .string()
    .trim()
    .min(1, 'Item name is required')
    .max(200, 'Item name must be at most 200 characters'),
  description: optionalText(500, 'Item description'),
  hsnSacCode: z
    .string()
    .trim()
    .regex(HSN_REGEX, 'HSN/SAC code must be 4 to 8 digits')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  unit: z.string().trim().max(20, 'Unit must be at most 20 characters').optional(),
  quantity: z.coerce
    .number({ invalid_type_error: 'Quantity must be a number' })
    .gt(0, 'Quantity must be greater than zero')
    .max(9999999, 'Quantity is too large'),
  unitPrice: z.coerce
    .number({ invalid_type_error: 'Rate must be a number' })
    .min(0, 'Rate cannot be negative')
    .max(999999999.99, 'Rate is too large'),
  discountPercent: z.coerce
    .number({ invalid_type_error: 'Discount must be a number' })
    .min(0, 'Discount cannot be negative')
    .max(100, 'Discount cannot exceed 100%')
    .optional(),
  taxRate: z.coerce
    .number({ invalid_type_error: 'GST rate must be a number' })
    .min(0, 'GST rate cannot be negative')
    .max(100, 'GST rate cannot exceed 100%')
    .optional()
});

const invoiceBodyFields = {
  customerId: uuid('customer'),
  invoiceNumber: optionalText(50, 'Invoice number'),
  billType: optionalText(50, 'Bill type'),
  issueDate: dateField('Issue date'),
  dueDate: dateField('Due date'),
  poNumber: optionalText(50, 'Order / PO number'),
  orderDate: optionalDateField('Order date'),
  challanNo: optionalText(50, 'Challan number'),
  challanDate: optionalDateField('Challan date'),
  reference: optionalText(100, 'Reference'),
  modeOfDispatch: optionalText(100, 'Mode of dispatch'),
  lhNo: optionalText(50, 'LH number'),
  lhDate: optionalDateField('LH date'),
  dcNo: optionalText(50, 'Your D.C. number'),
  dcDate: optionalDateField('Your D.C. date'),
  paymentTerms: optionalText(100, 'Payment terms'),
  currency: z.string().trim().length(3, 'Currency must be a 3 letter code').optional(),
  placeOfSupply: optionalText(80, 'Place of supply'),
  isReverseCharge: z.boolean().optional(),
  notes: optionalText(2000, 'Notes'),
  terms: optionalText(2000, 'Terms'),
  internalNotes: optionalText(2000, 'Internal notes'),
  status: z.enum([InvoiceStatus.DRAFT, InvoiceStatus.SENT]).optional(),
  items: z
    .array(invoiceItemSchema)
    .min(1, 'Add at least one line item')
    .max(200, 'An invoice cannot have more than 200 line items')
};

export const createInvoiceSchema = z.object({
  body: z.object({
    customerId: invoiceBodyFields.customerId,
    invoiceNumber: invoiceBodyFields.invoiceNumber,
    billType: invoiceBodyFields.billType,
    issueDate: invoiceBodyFields.issueDate.optional(),
    dueDate: invoiceBodyFields.dueDate.optional(),
    poNumber: invoiceBodyFields.poNumber,
    orderDate: invoiceBodyFields.orderDate,
    challanNo: invoiceBodyFields.challanNo,
    challanDate: invoiceBodyFields.challanDate,
    reference: invoiceBodyFields.reference,
    modeOfDispatch: invoiceBodyFields.modeOfDispatch,
    lhNo: invoiceBodyFields.lhNo,
    lhDate: invoiceBodyFields.lhDate,
    dcNo: invoiceBodyFields.dcNo,
    dcDate: invoiceBodyFields.dcDate,
    paymentTerms: invoiceBodyFields.paymentTerms,
    currency: invoiceBodyFields.currency,
    placeOfSupply: invoiceBodyFields.placeOfSupply,
    isReverseCharge: invoiceBodyFields.isReverseCharge,
    notes: invoiceBodyFields.notes,
    terms: invoiceBodyFields.terms,
    internalNotes: invoiceBodyFields.internalNotes,
    status: invoiceBodyFields.status,
    items: invoiceBodyFields.items
  })
});

export const updateInvoiceSchema = z.object({
  params: z.object({ id: uuid('invoice id') }),
  body: z
    .object({
      customerId: invoiceBodyFields.customerId.optional(),
      billType: invoiceBodyFields.billType,
      issueDate: invoiceBodyFields.issueDate.optional(),
      dueDate: invoiceBodyFields.dueDate.optional(),
      poNumber: invoiceBodyFields.poNumber,
      orderDate: invoiceBodyFields.orderDate,
      challanNo: invoiceBodyFields.challanNo,
      challanDate: invoiceBodyFields.challanDate,
      reference: invoiceBodyFields.reference,
      modeOfDispatch: invoiceBodyFields.modeOfDispatch,
      lhNo: invoiceBodyFields.lhNo,
      lhDate: invoiceBodyFields.lhDate,
      dcNo: invoiceBodyFields.dcNo,
      dcDate: invoiceBodyFields.dcDate,
      paymentTerms: invoiceBodyFields.paymentTerms,
      currency: invoiceBodyFields.currency,
      placeOfSupply: invoiceBodyFields.placeOfSupply,
      isReverseCharge: invoiceBodyFields.isReverseCharge,
      notes: invoiceBodyFields.notes,
      terms: invoiceBodyFields.terms,
      internalNotes: invoiceBodyFields.internalNotes,
      items: invoiceBodyFields.items.optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const invoiceIdSchema = z.object({
  params: z.object({ id: uuid('invoice id') })
});

export const invoiceStatusSchema = z.object({
  params: z.object({ id: uuid('invoice id') }),
  body: z.object({
    status: z.enum([InvoiceStatus.DRAFT, InvoiceStatus.SENT], {
      errorMap: () => ({ message: 'Status must be either DRAFT or SENT' })
    })
  })
});

export const cancelInvoiceSchema = z.object({
  params: z.object({ id: uuid('invoice id') }),
  body: z.object({
    reason: optionalText(300, 'Cancellation reason')
  })
});

/** Comma separated statuses, e.g. ?status=SENT,OVERDUE */
const statusListParam = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((entry) => entry.trim().toUpperCase())
          .filter((entry): entry is InvoiceStatus =>
            Object.values(InvoiceStatus).includes(entry as InvoiceStatus)
          )
      : undefined
  );

export const listInvoicesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be 1 or greater')
      .max(100, 'Limit cannot exceed 100')
      .default(10),
    search: z.string().trim().max(150).optional(),
    status: statusListParam,
    billType: z.string().trim().optional(),
    customerId: z.string().uuid('Invalid customer id').optional(),
    financialYear: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, 'Financial year must look like 2026-27')
      .optional(),
    year: z.coerce.number().int().min(1970).max(2200).optional(),
    month: z.coerce.number().int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12').optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    onlyOutstanding: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    sortBy: z
      .enum([
        'invoiceNumber',
        'issueDate',
        'dueDate',
        'grandTotal',
        'balanceDue',
        'billingName',
        'status',
        'createdAt',
        'updatedAt'
      ])
      .default('issueDate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});

export const invoiceDashboardSchema = z.object({
  query: z.object({
    financialYear: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, 'Financial year must look like 2026-27')
      .optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional()
  })
});

export const invoiceActivitySchema = z.object({
  params: z.object({ id: uuid('invoice id') }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
});

export const previewNumberSchema = z.object({
  query: z.object({
    documentType: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('INVOICE'),
    date: z.string().trim().optional()
  })
});
