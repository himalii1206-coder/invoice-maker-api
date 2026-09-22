import { z } from 'zod';

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === null || v === undefined ? undefined : v));

const dateSchema = z
  .union([z.string(), z.date(), z.null(), z.undefined()])
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  });

export const purchaseBillItemSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, 'Item name is required').max(200),
  description: optionalText(500, 'Description'),
  hsnSacCode: optionalText(20, 'HSN/SAC code'),
  category: z.enum(['GOODS', 'SERVICE', 'RAW_MATERIAL', 'CAPITAL_ASSET', 'EXPENSE']).default('GOODS'),
  unit: z.string().trim().max(20).default('PCS'),
  sortOrder: z.coerce.number().int().default(0),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0)
});

export const createPurchaseBillSchema = z.object({
  body: z.object({
    vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
    billNumber: z.string().trim().optional(),
    vendorInvoiceNumber: z.string().trim().min(1, 'Vendor Invoice / Bill No is required').max(100),
    status: z.enum(['DRAFT', 'RECEIVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).default('RECEIVED'),
    billDate: dateSchema.default(() => new Date()),
    dueDate: dateSchema,
    paymentTerms: optionalText(100, 'Payment terms'),
    currency: z.string().trim().max(10).default('INR'),

    // Logistics & Inward references
    poNumber: optionalText(100, 'PO Number'),
    poDate: dateSchema,
    grnNumber: optionalText(100, 'GRN / Challan Number'),
    grnDate: dateSchema,
    transporterName: optionalText(150, 'Transporter Name'),
    vehicleNumber: optionalText(50, 'Vehicle Number'),
    lrNumber: optionalText(50, 'LR / Bilty Number'),
    lrDate: dateSchema,

    // Vendor Snapshot
    vendorName: z.string().trim().min(1, 'Vendor name is required').max(150),
    vendorGstin: optionalText(20, 'Vendor GSTIN'),
    vendorPhone: optionalText(30, 'Vendor Phone'),
    vendorEmail: optionalText(150, 'Vendor Email'),
    vendorAddress: optionalText(500, 'Vendor Address'),
    vendorCity: optionalText(100, 'Vendor City'),
    vendorState: optionalText(100, 'Vendor State'),
    vendorCountry: z.string().trim().default('India'),
    vendorPostalCode: optionalText(20, 'Vendor Postal Code'),

    // GST & Tax compliance
    placeOfSupply: optionalText(100, 'Place of supply'),
    placeOfSupplyCode: optionalText(10, 'Place of supply code'),
    isIgst: z.boolean().optional(),
    isReverseCharge: z.boolean().default(false),
    itcEligibility: z.enum(['INPUTS', 'CAPITAL_GOODS', 'INPUT_SERVICES', 'INELIGIBLE']).default('INPUTS'),

    // Other inward charges & adjustments
    otherCharges: z.coerce.number().min(0).default(0),
    roundOff: z.coerce.number().default(0),

    notes: optionalText(1000, 'Notes'),
    terms: optionalText(1000, 'Terms'),
    internalNotes: optionalText(1000, 'Internal Notes'),
    attachmentUrl: optionalText(500, 'Attachment URL'),

    items: z.array(purchaseBillItemSchema).min(1, 'At least one line item is required')
  })
});

export const updatePurchaseBillSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Purchase Bill ID')
  }),
  body: z.object({
    vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
    billNumber: z.string().trim().optional(),
    vendorInvoiceNumber: z.string().trim().min(1, 'Vendor Invoice / Bill No is required').max(100).optional(),
    status: z.enum(['DRAFT', 'RECEIVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
    billDate: dateSchema,
    dueDate: dateSchema,
    paymentTerms: optionalText(100, 'Payment terms'),
    currency: z.string().trim().max(10).optional(),

    // Logistics
    poNumber: optionalText(100, 'PO Number'),
    poDate: dateSchema,
    grnNumber: optionalText(100, 'GRN / Challan Number'),
    grnDate: dateSchema,
    transporterName: optionalText(150, 'Transporter Name'),
    vehicleNumber: optionalText(50, 'Vehicle Number'),
    lrNumber: optionalText(50, 'LR / Bilty Number'),
    lrDate: dateSchema,

    // Vendor Snapshot
    vendorName: z.string().trim().min(1, 'Vendor name is required').max(150).optional(),
    vendorGstin: optionalText(20, 'Vendor GSTIN'),
    vendorPhone: optionalText(30, 'Vendor Phone'),
    vendorEmail: optionalText(150, 'Vendor Email'),
    vendorAddress: optionalText(500, 'Vendor Address'),
    vendorCity: optionalText(100, 'Vendor City'),
    vendorState: optionalText(100, 'Vendor State'),
    vendorCountry: z.string().trim().optional(),
    vendorPostalCode: optionalText(20, 'Vendor Postal Code'),

    // GST & Tax
    placeOfSupply: optionalText(100, 'Place of supply'),
    placeOfSupplyCode: optionalText(10, 'Place of supply code'),
    isIgst: z.boolean().optional(),
    isReverseCharge: z.boolean().optional(),
    itcEligibility: z.enum(['INPUTS', 'CAPITAL_GOODS', 'INPUT_SERVICES', 'INELIGIBLE']).optional(),

    otherCharges: z.coerce.number().min(0).optional(),
    roundOff: z.coerce.number().optional(),

    notes: optionalText(1000, 'Notes'),
    terms: optionalText(1000, 'Terms'),
    internalNotes: optionalText(1000, 'Internal Notes'),
    attachmentUrl: optionalText(500, 'Attachment URL'),

    items: z.array(purchaseBillItemSchema).min(1, 'At least one line item is required').optional()
  })
});

export const purchaseBillIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Purchase Bill ID')
  })
});

export const listPurchaseBillsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(150).optional(),
    vendorId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'RECEIVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
    financialYear: z.string().trim().optional(),
    startDate: dateSchema,
    endDate: dateSchema,
    sortBy: z
      .enum(['billDate', 'dueDate', 'grandTotal', 'balanceDue', 'billNumber', 'createdAt'])
      .default('billDate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});

export const recordPurchasePaymentSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Purchase Bill ID')
  }),
  body: z.object({
    amount: z.coerce.number().positive('Payment amount must be greater than zero'),
    paymentDate: dateSchema.default(() => new Date()),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER']).default('BANK_TRANSFER'),
    referenceNumber: optionalText(100, 'Reference / UTR / Cheque Number'),
    notes: optionalText(500, 'Notes')
  })
});
