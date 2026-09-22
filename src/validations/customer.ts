import { z } from 'zod';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const PHONE_REGEX = /^(\+91[\-\s]?)?[6-9]\d{9}$|^[0-9]{10}$/;
const ACCOUNT_NO_REGEX = /^[0-9]{9,18}$/;

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

/**
 * Whether a phone number, state or GSTIN is *required* is business policy set
 * in Settings, not a property of the data, so the schema only checks the format
 * of whatever is supplied. `CustomerService` applies the presence rules, which
 * keeps one authority for them and lets an existing customer stay valid after a
 * business tightens the rule.
 */
const optionalFormatted = (schema: z.ZodString) =>
  schema
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === null ? undefined : v));

const customerFields = {
  name: z
    .string({ required_error: 'Account Head is required' })
    .trim()
    .min(1, 'Account Head is required')
    .max(150, 'Account Head must be at most 150 characters'),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(150, 'Email must be at most 150 characters')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v?.toLowerCase())),
  phone: optionalFormatted(
    z
      .string()
      .trim()
      .regex(PHONE_REGEX, 'Invalid mobile number (must be a valid 10-digit number)')
  ),
  type: z.enum(['INDIVIDUAL', 'BUSINESS'], {
    errorMap: () => ({ message: 'Type must be either INDIVIDUAL or BUSINESS' })
  }),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Invalid GSTIN format (must be 15 alphanumeric characters, e.g. 24AAACC1206D1ZM)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  address: z
    .string({ required_error: 'Billing address is required' })
    .trim()
    .min(1, 'Billing address is required')
    .max(500, 'Billing address must be at most 500 characters'),
  factoryAddress: z
    .string({ required_error: 'Factory address is required' })
    .trim()
    .min(1, 'Factory address is required')
    .max(500, 'Factory address must be at most 500 characters'),
  city: z
    .string({ required_error: 'City is required' })
    .trim()
    .min(1, 'City is required')
    .max(100, 'City must be at most 100 characters'),
  state: optionalFormatted(
    z.string().trim().min(1, 'State cannot be blank').max(100, 'State must be at most 100 characters')
  ),
  country: optionalText(100, 'Country'),
  postalCode: z
    .string()
    .trim()
    .regex(PINCODE_REGEX, 'Invalid pincode (must be a 6-digit number)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  officeNo: optionalText(30, 'Office number'),
  contactPerson: optionalText(150, 'Contact person'),
  accountGroup: optionalText(100, 'Account group'),
  openingBalance: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const parsed = typeof val === 'number' ? val : parseFloat(val);
      return isNaN(parsed) ? undefined : parsed;
    }),
  openingBalanceDate: z
    .union([z.string(), z.date(), z.null(), z.undefined()])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const d = new Date(val);
      return isNaN(d.getTime()) ? undefined : d;
    }),
  balanceType: optionalText(10, 'Balance type'),
  partyCategory: optionalText(100, 'Party category'),
  narration1: optionalText(255, 'Narration 1'),
  narration2: optionalText(255, 'Narration 2'),
  bankName: optionalText(150, 'Bank name'),
  accountNumber: z
    .string()
    .trim()
    .regex(ACCOUNT_NO_REGEX, 'Invalid account number (must be 9 to 18 digits)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  ifscCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_REGEX, 'Invalid IFSC code format (11 characters, 4 letters + 0 + 6 alphanumeric characters, e.g. HDFC0001234)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
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
    factoryAddress: customerFields.factoryAddress,
    city: customerFields.city,
    state: customerFields.state,
    country: customerFields.country,
    postalCode: customerFields.postalCode,
    officeNo: customerFields.officeNo,
    contactPerson: customerFields.contactPerson,
    accountGroup: customerFields.accountGroup,
    openingBalance: customerFields.openingBalance,
    openingBalanceDate: customerFields.openingBalanceDate,
    balanceType: customerFields.balanceType,
    partyCategory: customerFields.partyCategory,
    narration1: customerFields.narration1,
    narration2: customerFields.narration2,
    bankName: customerFields.bankName,
    accountNumber: customerFields.accountNumber,
    ifscCode: customerFields.ifscCode,
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
      phone: customerFields.phone.optional(),
      type: customerFields.type.optional(),
      gstin: customerFields.gstin,
      address: customerFields.address.optional(),
      factoryAddress: customerFields.factoryAddress.optional(),
      city: customerFields.city.optional(),
      state: customerFields.state.optional(),
      country: customerFields.country,
      postalCode: customerFields.postalCode,
      officeNo: customerFields.officeNo,
      contactPerson: customerFields.contactPerson,
      accountGroup: customerFields.accountGroup,
      openingBalance: customerFields.openingBalance,
      openingBalanceDate: customerFields.openingBalanceDate,
      balanceType: customerFields.balanceType,
      partyCategory: customerFields.partyCategory,
      narration1: customerFields.narration1,
      narration2: customerFields.narration2,
      bankName: customerFields.bankName,
      accountNumber: customerFields.accountNumber,
      ifscCode: customerFields.ifscCode,
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
    accountGroup: z.string().trim().max(100).optional(),
    partyCategory: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    sortBy: z
      .enum(['name', 'email', 'city', 'state', 'accountGroup', 'openingBalance', 'createdAt', 'updatedAt'])
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
