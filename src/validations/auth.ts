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
      .transform((v) => (v === '' ? undefined : v))
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
