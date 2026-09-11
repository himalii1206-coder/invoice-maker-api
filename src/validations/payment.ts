import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';

/** Turns "" into undefined so optional text fields can be cleared from a form. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v));

const amountField = z.coerce
  .number({ invalid_type_error: 'Amount must be a number' })
  .gt(0, 'Amount must be greater than zero')
  .max(999999999.99, 'Amount is too large');

const dateField = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), `${label} must be a valid date`);

export const createPaymentSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid invoice id') }),
  body: z.object({
    amount: amountField,
    paymentDate: dateField('Payment date').optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    referenceNumber: optionalText(80, 'Reference number'),
    notes: optionalText(500, 'Notes')
  })
});

export const updatePaymentSchema = z.object({
  params: z.object({ paymentId: z.string().uuid('Invalid payment id') }),
  body: z
    .object({
      amount: amountField.optional(),
      paymentDate: dateField('Payment date').optional(),
      paymentMethod: z.nativeEnum(PaymentMethod).optional(),
      referenceNumber: optionalText(80, 'Reference number'),
      notes: optionalText(500, 'Notes')
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const paymentIdSchema = z.object({
  params: z.object({ paymentId: z.string().uuid('Invalid payment id') })
});

export const invoicePaymentsSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid invoice id') })
});

export const listPaymentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(150).optional(),
    invoiceId: z.string().uuid('Invalid invoice id').optional(),
    customerId: z.string().uuid('Invalid customer id').optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    sortBy: z.enum(['paymentDate', 'amount', 'createdAt']).default('paymentDate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});
