import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === null || v === undefined ? null : v));

export const updateCompanySchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Business name cannot be empty')
      .max(150, 'Business name must be at most 150 characters')
      .optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(150)
      .optional()
      .nullable()
      .or(z.literal(''))
      .transform((v) => (v === '' || v === null || v === undefined ? null : v?.toLowerCase())),
    phone: optionalText(30),
    address: optionalText(500),
    city: optionalText(100),
    state: optionalText(100),
    country: z.string().max(100).default('India'),
    postalCode: optionalText(20),
    gstin: optionalText(20),
    pan: optionalText(20),
    bankName: optionalText(150),
    accountNumber: optionalText(50),
    ifscCode: optionalText(30),
    branch: optionalText(100),
    accountHolder: optionalText(150),
    upiId: z
      .string()
      .trim()
      .max(100, 'UPI ID must be at most 100 characters')
      .regex(/^[\w.\-]{2,}@[A-Za-z]{2,}$/, 'Enter a valid UPI ID, for example business@okhdfcbank')
      .optional()
      .nullable()
      .or(z.literal(''))
      .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
    paymentInstructions: optionalText(500),
    acceptedPaymentMethods: z
      .array(z.nativeEnum(PaymentMethod))
      .max(6, 'Too many payment methods')
      .transform((values) => Array.from(new Set(values)))
      .optional()
  })
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>['body'];
