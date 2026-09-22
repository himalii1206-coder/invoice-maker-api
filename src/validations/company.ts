import { z } from 'zod';

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
      .string({ required_error: 'Business name is required' })
      .trim()
      .min(1, 'Business name is required')
      .max(150, 'Business name must be at most 150 characters'),
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
    branch: optionalText(100)
  })
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>['body'];
