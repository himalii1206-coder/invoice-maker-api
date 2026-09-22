import { z } from 'zod';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const PHONE_REGEX = /^(\+91[\-\s]?)?[6-9]\d{9}$|^[0-9]{10}$/;
const ACCOUNT_NO_REGEX = /^[0-9]{9,18}$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v));

const vendorFields = {
  name: z
    .string({ required_error: 'Vendor / Supplier Name is required' })
    .trim()
    .min(1, 'Vendor / Supplier Name is required')
    .max(150, 'Vendor Name must be at most 150 characters'),
  tradeName: optionalText(150, 'Trade name'),
  contactPerson: optionalText(150, 'Contact person'),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(150, 'Email must be at most 150 characters')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v?.toLowerCase())),
  phone: z
    .string({ required_error: 'Phone / Mobile number is required' })
    .trim()
    .regex(PHONE_REGEX, 'Invalid phone number (must be a valid 10-digit number)'),
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
  pan: optionalText(10, 'PAN'),
  address: z
    .string({ required_error: 'Address is required' })
    .trim()
    .min(1, 'Address is required')
    .max(500, 'Address must be at most 500 characters'),
  city: z
    .string({ required_error: 'City is required' })
    .trim()
    .min(1, 'City is required')
    .max(100, 'City must be at most 100 characters'),
  state: z
    .string({ required_error: 'State is required' })
    .trim()
    .min(1, 'State is required')
    .max(100, 'State must be at most 100 characters'),
  country: optionalText(100, 'Country'),
  postalCode: z
    .string()
    .trim()
    .regex(PINCODE_REGEX, 'Invalid pincode (must be a 6-digit number)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
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
    .regex(IFSC_REGEX, 'Invalid IFSC code format (11 characters, e.g. HDFC0001234)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  branch: optionalText(100, 'Branch'),
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
  paymentTerms: optionalText(100, 'Payment terms'),
  partyCategory: optionalText(100, 'Party category'),
  narration: optionalText(500, 'Narration'),
  isActive: z.boolean()
};

export const createVendorSchema = z.object({
  body: z.object({
    name: vendorFields.name,
    tradeName: vendorFields.tradeName,
    contactPerson: vendorFields.contactPerson,
    email: vendorFields.email,
    phone: vendorFields.phone,
    type: vendorFields.type.optional(),
    gstin: vendorFields.gstin,
    pan: vendorFields.pan,
    address: vendorFields.address,
    city: vendorFields.city,
    state: vendorFields.state,
    country: vendorFields.country,
    postalCode: vendorFields.postalCode,
    bankName: vendorFields.bankName,
    accountNumber: vendorFields.accountNumber,
    ifscCode: vendorFields.ifscCode,
    branch: vendorFields.branch,
    openingBalance: vendorFields.openingBalance,
    openingBalanceDate: vendorFields.openingBalanceDate,
    balanceType: vendorFields.balanceType,
    paymentTerms: vendorFields.paymentTerms,
    partyCategory: vendorFields.partyCategory,
    narration: vendorFields.narration,
    isActive: vendorFields.isActive.optional()
  })
});

export const updateVendorSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid vendor ID')
  }),
  body: z
    .object({
      name: vendorFields.name.optional(),
      tradeName: vendorFields.tradeName,
      contactPerson: vendorFields.contactPerson,
      email: vendorFields.email,
      phone: vendorFields.phone.optional(),
      type: vendorFields.type.optional(),
      gstin: vendorFields.gstin,
      pan: vendorFields.pan,
      address: vendorFields.address.optional(),
      city: vendorFields.city.optional(),
      state: vendorFields.state.optional(),
      country: vendorFields.country,
      postalCode: vendorFields.postalCode,
      bankName: vendorFields.bankName,
      accountNumber: vendorFields.accountNumber,
      ifscCode: vendorFields.ifscCode,
      branch: vendorFields.branch,
      openingBalance: vendorFields.openingBalance,
      openingBalanceDate: vendorFields.openingBalanceDate,
      balanceType: vendorFields.balanceType,
      paymentTerms: vendorFields.paymentTerms,
      partyCategory: vendorFields.partyCategory,
      narration: vendorFields.narration,
      isActive: vendorFields.isActive.optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const vendorIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid vendor ID')
  })
});

export const listVendorsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
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
