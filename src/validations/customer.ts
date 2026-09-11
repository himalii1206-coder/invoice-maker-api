import { z } from 'zod';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PHONE_REGEX = /^[+]?[0-9\s-()]{7,20}$/;

/** Turns "" into undefined so optional text fields can be cleared from a form. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v));

const customerFields = {
  name: z
    .string()
    .trim()
    .min(2, 'Customer name must be at least 2 characters')
    .max(150, 'Customer name must be at most 150 characters'),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(150, 'Email must be at most 150 characters')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v?.toLowerCase())),
  phone: z
    .string()
    .trim()
    .regex(PHONE_REGEX, 'Invalid phone number')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  type: z.enum(['INDIVIDUAL', 'BUSINESS'], {
    errorMap: () => ({ message: 'Type must be either INDIVIDUAL or BUSINESS' })
  }),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Invalid GSTIN / tax number format')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  address: optionalText(255, 'Address'),
  city: optionalText(100, 'City'),
  state: optionalText(100, 'State'),
  country: optionalText(100, 'Country'),
  postalCode: optionalText(20, 'Postal code'),
  isActive: z.boolean()
};

export const createCustomerSchema = z.object({
  body: z.object({
    name: customerFields.name,
    email: customerFields.email,
    phone: customerFields.phone,
    type: customerFields.type.optional(),
    gstin: customerFields.gstin,
    address: customerFields.address,
    city: customerFields.city,
    state: customerFields.state,
    country: customerFields.country,
    postalCode: customerFields.postalCode,
    isActive: customerFields.isActive.optional()
  })
});

export const updateCustomerSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid customer id')
  }),
  body: z
    .object({
      name: customerFields.name.optional(),
      email: customerFields.email,
      phone: customerFields.phone,
      type: customerFields.type.optional(),
      gstin: customerFields.gstin,
      address: customerFields.address,
      city: customerFields.city,
      state: customerFields.state,
      country: customerFields.country,
      postalCode: customerFields.postalCode,
      isActive: customerFields.isActive.optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const customerIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid customer id')
  })
});

export const listCustomersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be 1 or greater')
      .max(100, 'Limit cannot exceed 100')
      .default(10),
    search: z.string().trim().max(150).optional(),
    type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    sortBy: z
      .enum(['name', 'email', 'city', 'state', 'createdAt', 'updatedAt'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});

export const customerStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid customer id')
  }),
  body: z.object({
    isActive: z.boolean({
      required_error: 'isActive is required',
      invalid_type_error: 'isActive must be a boolean'
    })
  })
});
