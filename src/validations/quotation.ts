import { z } from 'zod';
import { QuotationStatus } from '@prisma/client';

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

export const quotationItemSchema = z.object({
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
  unit: z.string().trim().max(20, 'Unit must be at most 20 characters').optional().default('PCS'),
  quantity: z.coerce
    .number({ invalid_type_error: 'Quantity must be a number' })
    .gt(0, 'Quantity must be greater than zero')
    .max(9999999, 'Quantity is too large'),
  rate: z.coerce
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

const quotationBodyFields = {
  customerId: z.string().uuid('Invalid customer id').nullish(),
  quotationNumber: optionalText(50, 'Quotation number'),
  subject: optionalText(250, 'Subject'),
  inquiryNumber: optionalText(100, 'Inquiry number'),
  inquiryDate: optionalDateField('Inquiry date'),
  referenceNumber: optionalText(100, 'Reference number'),
  quotationDate: dateField('Quotation date'),
  validUntil: optionalDateField('Valid until date'),
  paymentTerms: optionalText(100, 'Payment terms'),
  currency: z.string().trim().length(3, 'Currency must be a 3 letter code').optional().default('INR'),
  
  // Buyer Details Snapshot
  billingName: z.string().trim().min(1, 'M/S / Customer name is required').max(200),
  billingEmail: optionalText(150, 'Billing email'),
  billingPhone: optionalText(50, 'Billing phone'),
  billingGstin: optionalText(20, 'Billing GSTIN'),
  billingAddress: optionalText(500, 'Billing address'),
  billingCity: optionalText(100, 'Billing city'),
  billingState: optionalText(100, 'Billing state'),
  billingCountry: optionalText(100, 'Billing country'),
  billingPostalCode: optionalText(20, 'Billing postal code'),

  placeOfSupply: optionalText(80, 'Place of supply'),
  forwardingPackagingAmount: z.coerce
    .number({ invalid_type_error: 'Forwarding & packaging charge must be a number' })
    .min(0, 'Forwarding & packaging charge cannot be negative')
    .max(99999999, 'Forwarding & packaging charge is too large')
    .optional()
    .default(0),

  notes: optionalText(2000, 'Notes'),
  terms: optionalText(3000, 'Terms & conditions'),

  items: z.array(quotationItemSchema).min(1, 'A quotation must contain at least one line item')
};

export const createQuotationSchema = z.object({
  body: z.object(quotationBodyFields)
});

export const updateQuotationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid quotation id')
  }),
  body: z
    .object({
      ...quotationBodyFields,
      billingName: z.string().trim().min(1, 'M/S / Customer name is required').max(200).optional(),
      quotationDate: dateField('Quotation date').optional(),
      items: z.array(quotationItemSchema).min(1, 'A quotation must contain at least one line item').optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const quotationIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid quotation id')
  })
});

export const rejectQuotationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid quotation id')
  }),
  body: z.object({
    reason: optionalText(500, 'Rejection reason')
  }).optional()
});

export const cancelQuotationSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid quotation id')
  }),
  body: z.object({
    reason: optionalText(500, 'Cancellation reason')
  }).optional()
});

export const listQuotationsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be 1 or greater')
      .max(100, 'Limit cannot exceed 100')
      .default(10),
    search: z.string().trim().max(150).optional(),
    customerId: z.string().uuid('Invalid customer id').optional(),
    status: z
      .nativeEnum(QuotationStatus, {
        errorMap: () => ({ message: 'Invalid quotation status' })
      })
      .optional(),
    startDate: optionalDateField('Start date'),
    endDate: optionalDateField('End date'),
    financialYear: z.string().trim().optional(),
    sortBy: z
      .enum(['quotationNumber', 'quotationDate', 'validUntil', 'grandTotal', 'createdAt', 'billingName'])
      .default('quotationDate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});
