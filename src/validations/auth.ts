import { z } from 'zod';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PHONE_REGEX = /^(\+91[\-\s]?)?[6-9]\d{9}$|^[0-9]{10}$/;

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    businessName: z.string().min(2, 'Business name must be at least 2 characters'),
    phone: z
      .string()
      .trim()
      .regex(PHONE_REGEX, 'Invalid mobile number (must be a valid 10-digit number)')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? undefined : v)),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN_REGEX, 'Invalid GSTIN format (must be 15 alphanumeric characters, e.g. 24AAACC1206D1ZM)')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' ? undefined : v)),
    pan: z.string().trim().toUpperCase().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    address: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    city: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    state: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    postalCode: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    bankName: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    accountNumber: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    ifscCode: z.string().trim().toUpperCase().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    branch: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    upiId: z.string().trim().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    invoicePrefix: z.string().trim().max(10).optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
    nextInvoiceNumber: z.coerce.number().int().positive().optional()
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required')
  })
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required')
  })
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address')
  })
});

/**
 * Codes are either a 6-digit TOTP or a recovery code, which is hex in
 * `XXXXX-XXXXX` form. One field accepts both so the user does not have to tell
 * the form which kind they are pasting.
 */
const twoFactorCode = z
  .string()
  .trim()
  .min(6, 'Enter the 6-digit code from your authenticator app')
  .max(24, 'That code is too long');

export const verifyTwoFactorSchema = z.object({
  body: z.object({
    challengeToken: z.string().min(1, 'Sign in again to get a new code prompt'),
    code: twoFactorCode
  })
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(1, 'Your current password is required'),
      newPassword: z
        .string()
        .min(8, 'New password must be at least 8 characters long')
        .max(100, 'New password is too long')
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: 'The new password must be different from the current one',
      path: ['newPassword']
    })
});

export const enableTwoFactorSchema = z.object({
  body: z.object({ code: twoFactorCode })
});

export const passwordConfirmationSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Your password is required to confirm this change')
  })
});

export const sessionIdSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid session id') })
});
