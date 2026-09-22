import { z } from 'zod';

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

const productFields = {
  category: optionalText(100, 'Category'),
  productCode: optionalText(50, 'Product code'),
  name: z
    .string()
    .trim()
    .min(1, 'Product name is required')
    .max(150, 'Product name must be at most 150 characters'),
  unit: z
    .string()
    .trim()
    .min(1, 'Unit is required')
    .max(20, 'Unit must be at most 20 characters')
    .default('PCS'),
  hsnSacCode: z
    .string()
    .trim()
    .regex(HSN_REGEX, 'HSN code must be 4 to 8 digits')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  price: z.coerce
    .number({ invalid_type_error: 'Price must be a number' })
    .min(0, 'Price cannot be negative')
    .max(99999999.99, 'Price is too large'),
  customerId: z
    .string()
    .uuid('Please select a valid customer')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  description: optionalText(500, 'Description'),
  sku: optionalText(50, 'SKU'),
  taxRate: z.coerce
    .number({ invalid_type_error: 'Tax rate must be a number' })
    .min(0, 'Tax rate cannot be negative')
    .max(100, 'Tax rate cannot exceed 100')
    .optional(),
  isActive: z.boolean()
};

export const createProductSchema = z.object({
  body: z.object({
    category: productFields.category,
    productCode: productFields.productCode,
    name: productFields.name,
    unit: productFields.unit.optional(),
    hsnSacCode: productFields.hsnSacCode,
    price: productFields.price,
    customerId: productFields.customerId,
    description: productFields.description,
    sku: productFields.sku,
    taxRate: productFields.taxRate.optional(),
    isActive: productFields.isActive.optional()
  })
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid product id')
  }),
  body: z
    .object({
      category: productFields.category,
      productCode: productFields.productCode,
      name: productFields.name.optional(),
      unit: productFields.unit.optional(),
      hsnSacCode: productFields.hsnSacCode,
      price: productFields.price.optional(),
      customerId: productFields.customerId,
      description: productFields.description,
      sku: productFields.sku,
      taxRate: productFields.taxRate.optional(),
      isActive: productFields.isActive.optional()
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided to update'
    })
});

export const productIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid product id')
  })
});

export const productStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid product id')
  }),
  body: z.object({
    isActive: z.boolean({
      required_error: 'isActive is required',
      invalid_type_error: 'isActive must be a boolean'
    })
  })
});

export const listProductsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be 1 or greater')
      .max(100, 'Limit cannot exceed 100')
      .default(10),
    search: z.string().trim().max(150).optional(),
    category: z.string().trim().max(100).optional(),
    customerId: z.string().uuid('Invalid customer id').optional(),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    sortBy: z
      .enum(['name', 'price', 'taxRate', 'sku', 'productCode', 'category', 'createdAt', 'updatedAt'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});
