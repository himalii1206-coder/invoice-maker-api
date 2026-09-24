import { Prisma, QuotationStatus, DocumentType, ActivityType, InvoiceStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';
import { Decimalish, round2, toNumber, toPaise, fromPaise, roundOffToRupee } from '../utils/money.js';
import { financialYearOf } from '../utils/date.js';
import { resolveSupply, TaxLineInput } from './tax.js';
import { NumberingService } from './numbering.js';
import { InvoiceSettingsService } from './invoiceSettings.js';
import { encryptField, decryptField, decryptObject } from '../utils/encryption.js';

const decryptQuotation = <T extends Record<string, any>>(q: T): T => {
  if (!q) return q;
  const result: any = Array.isArray(q) ? [...q] : { ...q };
  if (result.billingGstin) {
    result.billingGstin = decryptField(result.billingGstin);
  }
  if (result.customer) {
    result.customer = decryptObject(result.customer, ['gstin', 'accountNumber']);
  }
  if (result.company) {
    result.company = decryptObject(result.company, ['gstin', 'pan', 'accountNumber', 'upiId']);
  }
  return result;
};

export interface QuotationItemInput {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  unit?: string;
  quantity: number;
  rate: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface CreateQuotationInput {
  customerId?: string | null;
  quotationNumber?: string;
  subject?: string | null;
  inquiryNumber?: string | null;
  inquiryDate?: string | Date | null;
  referenceNumber?: string | null;
  quotationDate?: string | Date;
  validUntil?: string | Date | null;
  paymentTerms?: string | null;
  currency?: string;

  // Buyer Snapshot
  billingName: string;
  billingEmail?: string | null;
  billingPhone?: string | null;
  billingGstin?: string | null;
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingCountry?: string;
  billingPostalCode?: string | null;

  placeOfSupply?: string | null;
  forwardingPackagingAmount?: number;
  notes?: string | null;
  terms?: string | null;
  status?: QuotationStatus;
  items: QuotationItemInput[];
}

export type UpdateQuotationInput = Partial<CreateQuotationInput>;

export interface QuotationListParams {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  status?: QuotationStatus;
  startDate?: string;
  endDate?: string;
  financialYear?: string;
  sortBy?: 'quotationNumber' | 'quotationDate' | 'validUntil' | 'grandTotal' | 'createdAt' | 'billingName';
  sortOrder?: 'asc' | 'desc';
}

export class QuotationService {
  /**
   * Calculates financial lines and totals for quotation items.
   */
  private static calculateFinancials(
    companyState: string | undefined,
    placeOfSupplyOrBuyerState: string | undefined,
    items: QuotationItemInput[],
    forwardingPackaging = 0,
    enableRoundOff = true
  ) {
    const supply = resolveSupply(companyState, placeOfSupplyOrBuyerState);

    let totalSubtotalPaise = 0;
    let totalDiscountPaise = 0;
    let totalTaxablePaise = 0;
    let totalCgstPaise = 0;
    let totalSgstPaise = 0;
    let totalIgstPaise = 0;
    let totalTaxPaise = 0;

    const calculatedItems = items.map((item, index) => {
      const qty = Number(item.quantity);
      const rate = Number(item.rate);
      const discPct = Number(item.discountPercent ?? 0);
      const taxRate = Number(item.taxRate ?? 0);

      // Line Gross Amount = Qty * Rate
      const lineSubtotal = round2(qty * rate);
      const lineSubtotalPaise = toPaise(lineSubtotal);

      // Discount Amount
      const lineDiscountPaise = discPct > 0 ? Math.round((lineSubtotalPaise * discPct) / 100) : 0;
      const lineDiscountAmount = fromPaise(lineDiscountPaise);

      // Taxable Amount
      const lineTaxablePaise = Math.max(0, lineSubtotalPaise - lineDiscountPaise);
      const lineTaxableAmount = fromPaise(lineTaxablePaise);

      // Tax Calculation
      let cgstRate = 0;
      let cgstPaise = 0;
      let sgstRate = 0;
      let sgstPaise = 0;
      let igstRate = 0;
      let igstPaise = 0;

      if (taxRate > 0) {
        if (supply.isIgst) {
          igstRate = taxRate;
          igstPaise = Math.round((lineTaxablePaise * taxRate) / 100);
        } else {
          cgstRate = round2(taxRate / 2);
          sgstRate = round2(taxRate / 2);
          const totalLineTaxPaise = Math.round((lineTaxablePaise * taxRate) / 100);
          cgstPaise = Math.floor(totalLineTaxPaise / 2);
          sgstPaise = totalLineTaxPaise - cgstPaise;
        }
      }

      const lineTaxPaise = cgstPaise + sgstPaise + igstPaise;
      const lineTaxAmount = fromPaise(lineTaxPaise);
      const lineTotalAmount = fromPaise(lineTaxablePaise + lineTaxPaise);

      totalSubtotalPaise += lineSubtotalPaise;
      totalDiscountPaise += lineDiscountPaise;
      totalTaxablePaise += lineTaxablePaise;
      totalCgstPaise += cgstPaise;
      totalSgstPaise += sgstPaise;
      totalIgstPaise += igstPaise;
      totalTaxPaise += lineTaxPaise;

      return {
        productId: item.productId ?? null,
        name: item.name.trim(),
        description: item.description?.trim() || null,
        hsnSacCode: item.hsnSacCode?.trim() || null,
        unit: item.unit?.trim() || 'PCS',
        sortOrder: index,
        quantity: new Prisma.Decimal(qty),
        rate: new Prisma.Decimal(rate),
        discountPercent: new Prisma.Decimal(discPct),
        discountAmount: new Prisma.Decimal(lineDiscountAmount),
        taxRate: new Prisma.Decimal(taxRate),
        subtotal: new Prisma.Decimal(lineSubtotal),
        taxableAmount: new Prisma.Decimal(lineTaxableAmount),
        cgstRate: new Prisma.Decimal(cgstRate),
        cgstAmount: new Prisma.Decimal(fromPaise(cgstPaise)),
        sgstRate: new Prisma.Decimal(sgstRate),
        sgstAmount: new Prisma.Decimal(fromPaise(sgstPaise)),
        igstRate: new Prisma.Decimal(igstRate),
        igstAmount: new Prisma.Decimal(fromPaise(igstPaise)),
        taxAmount: new Prisma.Decimal(lineTaxAmount),
        amount: new Prisma.Decimal(lineTotalAmount)
      };
    });

    const subtotal = fromPaise(totalSubtotalPaise);
    const discountAmount = fromPaise(totalDiscountPaise);
    const taxableAmount = fromPaise(totalTaxablePaise);
    const cgstAmount = fromPaise(totalCgstPaise);
    const sgstAmount = fromPaise(totalSgstPaise);
    const igstAmount = fromPaise(totalIgstPaise);
    const taxAmount = fromPaise(totalTaxPaise);

    const fwdAmount = round2(Math.max(0, forwardingPackaging));
    const secondTotal = round2(taxableAmount + taxAmount + fwdAmount);

    let roundOff = 0;
    let grandTotal = secondTotal;

    if (enableRoundOff) {
      const roundRes = roundOffToRupee(secondTotal);
      roundOff = roundRes.adjustment;
      grandTotal = roundRes.total;
    }

    return {
      supply,
      items: calculatedItems,
      totals: {
        subtotal: new Prisma.Decimal(subtotal),
        discountAmount: new Prisma.Decimal(discountAmount),
        taxableAmount: new Prisma.Decimal(taxableAmount),
        cgstAmount: new Prisma.Decimal(cgstAmount),
        sgstAmount: new Prisma.Decimal(sgstAmount),
        igstAmount: new Prisma.Decimal(igstAmount),
        taxAmount: new Prisma.Decimal(taxAmount),
        forwardingPackagingAmount: new Prisma.Decimal(fwdAmount),
        secondTotal: new Prisma.Decimal(secondTotal),
        roundOff: new Prisma.Decimal(roundOff),
        grandTotal: new Prisma.Decimal(grandTotal)
      }
    };
  }

  /**
   * Creates a new quotation.
   */
  static async create(companyId: string, input: CreateQuotationInput, userId?: string, ipAddress?: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true }
    });

    if (!company) {
      throw AppError.notFound('Company not found');
    }

    const settings = await InvoiceSettingsService.getOrCreate(companyId);

    // If customerId is provided, verify it belongs to this company and optionally snapshot details
    let customerSnapshot: any = {};
    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, companyId }
      });
      if (customer) {
        const decryptedCust = decryptObject(customer, ['gstin', 'accountNumber']);
        customerSnapshot = {
          billingName: decryptedCust.name,
          billingEmail: decryptedCust.email,
          billingPhone: decryptedCust.phone,
          billingGstin: decryptedCust.gstin,
          billingAddress: decryptedCust.address || decryptedCust.factoryAddress,
          billingCity: decryptedCust.city,
          billingState: decryptedCust.state,
          billingCountry: decryptedCust.country || 'India',
          billingPostalCode: decryptedCust.postalCode
        };
      }
    }

    const qDate = input.quotationDate ? new Date(input.quotationDate) : new Date();
    const financialYear = financialYearOf(qDate);

    const placeOfSupplyTarget = input.placeOfSupply || input.billingState || customerSnapshot.billingState;

    const { supply, items: calculatedItems, totals } = this.calculateFinancials(
      company.state || undefined,
      placeOfSupplyTarget || undefined,
      input.items,
      input.forwardingPackagingAmount ?? 0,
      settings.enableRoundOff
    );

    const initialStatus = input.status || QuotationStatus.DRAFT;

    const quotation = await prisma.$transaction(async (tx) => {
      // Allocate quotation number inside transaction
      let quotationNumber = input.quotationNumber?.trim();
      let sequenceNo = 0;

      if (!quotationNumber) {
        const allocated = await NumberingService.allocate(tx, companyId, DocumentType.QUOTATION, qDate);
        quotationNumber = allocated.number;
        sequenceNo = allocated.sequenceNo;
      } else {
        const existing = await tx.quotation.findUnique({
          where: {
            companyId_quotationNumber: { companyId, quotationNumber }
          }
        });
        if (existing) {
          throw AppError.conflict(`Quotation number "${quotationNumber}" already exists`);
        }
        sequenceNo = NumberingService.extractSequenceNo(quotationNumber);
        await NumberingService.reserveManualNumber(tx, companyId, DocumentType.QUOTATION, sequenceNo, qDate);
      }

      const created = await tx.quotation.create({
        data: {
          companyId,
          customerId: input.customerId || null,
          quotationNumber,
          sequenceNo,
          financialYear,
          status: initialStatus,
          subject: input.subject?.trim() || null,
          inquiryNumber: input.inquiryNumber?.trim() || null,
          inquiryDate: input.inquiryDate ? new Date(input.inquiryDate) : null,
          referenceNumber: input.referenceNumber?.trim() || null,
          quotationDate: qDate,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          paymentTerms: input.paymentTerms?.trim() || '50% Advance',
          currency: input.currency || 'INR',

          billingName: input.billingName?.trim() || customerSnapshot.billingName || '',
          billingEmail: input.billingEmail?.trim() || customerSnapshot.billingEmail || null,
          billingPhone: input.billingPhone?.trim() || customerSnapshot.billingPhone || null,
          billingGstin: (input.billingGstin ? decryptField(input.billingGstin.trim()) : null) || customerSnapshot.billingGstin || null,
          billingAddress: input.billingAddress?.trim() || customerSnapshot.billingAddress || null,
          billingCity: input.billingCity?.trim() || customerSnapshot.billingCity || null,
          billingState: input.billingState?.trim() || customerSnapshot.billingState || null,
          billingCountry: input.billingCountry?.trim() || customerSnapshot.billingCountry || 'India',
          billingPostalCode: input.billingPostalCode?.trim() || customerSnapshot.billingPostalCode || null,

          placeOfSupply: supply.placeOfSupply || null,
          placeOfSupplyCode: supply.placeOfSupplyCode || null,
          isIgst: supply.isIgst,

          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          taxAmount: totals.taxAmount,
          forwardingPackagingAmount: totals.forwardingPackagingAmount,
          secondTotal: totals.secondTotal,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,

          notes: input.notes?.trim() || null,
          terms: input.terms?.trim() || null,

          sentAt: initialStatus === QuotationStatus.SENT ? new Date() : null,

          items: {
            create: calculatedItems
          }
        },
        include: {
          items: true,
          customer: true
        }
      });

      // Log creation activity
      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: created.id,
          userId: userId || null,
          action: ActivityType.CREATED,
          description: `Created with total ₹${created.grandTotal}`,
          metadata: {
            quotationNumber: created.quotationNumber,
            grandTotal: created.grandTotal.toString()
          },
          ipAddress: ipAddress || null
        }
      });

      return created;
    });

    return decryptQuotation(quotation);
  }

  /**
   * Updates an existing quotation.
   */
  static async update(
    companyId: string,
    quotationId: string,
    input: UpdateQuotationInput,
    userId?: string,
    ipAddress?: string
  ) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: { items: true }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Converted quotations cannot be modified');
    }

    if (existing.status === QuotationStatus.CANCELLED) {
      throw AppError.badRequest('Cancelled quotations cannot be modified');
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true }
    });

    const settings = await InvoiceSettingsService.getOrCreate(companyId);

    const qDate = input.quotationDate ? new Date(input.quotationDate) : existing.quotationDate;
    const financialYear = financialYearOf(qDate);

    // If new items provided, recalculate. Otherwise reuse existing lines.
    const itemsInput: QuotationItemInput[] = input.items
      ? input.items
      : existing.items.map((i) => ({
          productId: i.productId,
          name: i.name,
          description: i.description,
          hsnSacCode: i.hsnSacCode,
          unit: i.unit,
          quantity: toNumber(i.quantity),
          rate: toNumber(i.rate),
          discountPercent: toNumber(i.discountPercent),
          taxRate: toNumber(i.taxRate)
        }));

    const placeOfSupplyTarget =
      input.placeOfSupply !== undefined
        ? input.placeOfSupply
        : input.billingState !== undefined
        ? input.billingState
        : existing.placeOfSupply || existing.billingState;

    const fwdAmount =
      input.forwardingPackagingAmount !== undefined
        ? input.forwardingPackagingAmount
        : toNumber(existing.forwardingPackagingAmount);

    const { supply, items: calculatedItems, totals } = this.calculateFinancials(
      company?.state || undefined,
      placeOfSupplyTarget || undefined,
      itemsInput,
      fwdAmount,
      settings.enableRoundOff
    );

    const updated = await prisma.$transaction(async (tx) => {
      // If items are provided, replace existing items
      if (input.items) {
        await tx.quotationItem.deleteMany({
          where: { quotationId: existing.id }
        });
      }

      const res = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          customerId: input.customerId !== undefined ? input.customerId : existing.customerId,
          subject: input.subject !== undefined ? input.subject?.trim() || null : existing.subject,
          inquiryNumber: input.inquiryNumber !== undefined ? input.inquiryNumber?.trim() || null : existing.inquiryNumber,
          inquiryDate: input.inquiryDate !== undefined ? (input.inquiryDate ? new Date(input.inquiryDate) : null) : existing.inquiryDate,
          referenceNumber: input.referenceNumber !== undefined ? input.referenceNumber?.trim() || null : existing.referenceNumber,
          quotationDate: qDate,
          financialYear,
          validUntil: input.validUntil !== undefined ? (input.validUntil ? new Date(input.validUntil) : null) : existing.validUntil,
          paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms?.trim() || null : existing.paymentTerms,
          currency: input.currency || existing.currency,

          billingName: input.billingName !== undefined ? input.billingName.trim() : existing.billingName,
          billingEmail: input.billingEmail !== undefined ? input.billingEmail?.trim() || null : existing.billingEmail,
          billingPhone: input.billingPhone !== undefined ? input.billingPhone?.trim() || null : existing.billingPhone,
          billingGstin: input.billingGstin !== undefined ? (input.billingGstin ? decryptField(input.billingGstin.trim()) : null) : decryptField(existing.billingGstin),
          billingAddress: input.billingAddress !== undefined ? input.billingAddress?.trim() || null : existing.billingAddress,
          billingCity: input.billingCity !== undefined ? input.billingCity?.trim() || null : existing.billingCity,
          billingState: input.billingState !== undefined ? input.billingState?.trim() || null : existing.billingState,
          billingCountry: input.billingCountry !== undefined ? input.billingCountry?.trim() || 'India' : existing.billingCountry,
          billingPostalCode: input.billingPostalCode !== undefined ? input.billingPostalCode?.trim() || null : existing.billingPostalCode,

          placeOfSupply: supply.placeOfSupply || null,
          placeOfSupplyCode: supply.placeOfSupplyCode || null,
          isIgst: supply.isIgst,

          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableAmount: totals.taxableAmount,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          taxAmount: totals.taxAmount,
          forwardingPackagingAmount: totals.forwardingPackagingAmount,
          secondTotal: totals.secondTotal,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal,

          notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
          terms: input.terms !== undefined ? input.terms?.trim() || null : existing.terms,

          items: input.items
            ? {
                create: calculatedItems
              }
            : undefined
        },
        include: {
          items: true,
          customer: true
        }
      });

      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: res.id,
          userId: userId || null,
          action: ActivityType.UPDATED,
          description: `Updated quotation details. New Total: ₹${res.grandTotal}`,
          metadata: {
            quotationNumber: res.quotationNumber,
            grandTotal: res.grandTotal.toString()
          },
          ipAddress: ipAddress || null
        }
      });

      return res;
    });

    return decryptQuotation(updated);
  }

  /**
   * Retrieves single quotation detail by ID.
   */
  static async getById(companyId: string, quotationId: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' }
        },
        customer: true,
        convertedInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            grandTotal: true,
            status: true
          }
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: { firstName: true, lastName: true, email: true }
            }
          }
        },
        company: {
          include: {
            invoiceSettings: true
          }
        }
      }
    });

    if (!quotation) {
      throw AppError.notFound('Quotation not found');
    }

    // Lazy check for expiration: If SENT and validUntil < today => status is EXPIRED
    let displayStatus = quotation.status;
    if (
      quotation.status === QuotationStatus.SENT &&
      quotation.validUntil &&
      new Date(quotation.validUntil).getTime() < new Date().setHours(0, 0, 0, 0)
    ) {
      displayStatus = QuotationStatus.EXPIRED;
    }

    return decryptQuotation({
      ...quotation,
      status: displayStatus
    });
  }

  /**
   * Lists quotations with search, filters, pagination and sorting.
   */
  static async list(companyId: string, params: QuotationListParams) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));
    const skip = (page - 1) * limit;

    const where: Prisma.QuotationWhereInput = {
      companyId
    };

    if (params.search) {
      const q = params.search.trim();
      where.OR = [
        { quotationNumber: { contains: q, mode: 'insensitive' } },
        { billingName: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { inquiryNumber: { contains: q, mode: 'insensitive' } },
        { referenceNumber: { contains: q, mode: 'insensitive' } }
      ];
    }

    if (params.customerId) {
      where.customerId = params.customerId;
    }

    if (params.status) {
      if (params.status === QuotationStatus.EXPIRED) {
        where.status = QuotationStatus.SENT;
        where.validUntil = {
          lt: new Date()
        };
      } else {
        where.status = params.status;
      }
    }

    if (params.financialYear) {
      where.financialYear = params.financialYear;
    }

    if (params.startDate || params.endDate) {
      where.quotationDate = {};
      if (params.startDate) {
        where.quotationDate.gte = new Date(params.startDate);
      }
      if (params.endDate) {
        const end = new Date(params.endDate);
        end.setHours(23, 59, 59, 999);
        where.quotationDate.lte = end;
      }
    }

    const sortBy = params.sortBy || 'quotationDate';
    const sortOrder = params.sortOrder || 'desc';

    const [items, total, summaryAgg] = await Promise.all([
      prisma.quotation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true }
          },
          convertedInvoice: {
            select: { id: true, invoiceNumber: true }
          }
        }
      }),
      prisma.quotation.count({ where }),
      prisma.quotation.aggregate({
        where: { companyId },
        _count: { id: true },
        _sum: { grandTotal: true }
      })
    ]);

    // Compute active statuses counts for KPIs
    const statusCounts = await prisma.quotation.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { id: true }
    });

    const countsMap = statusCounts.reduce<Record<string, number>>((acc, curr) => {
      acc[curr.status] = curr._count.id;
      return acc;
    }, {});

    // Format items with display status (expired check)
    const nowTs = new Date().setHours(0, 0, 0, 0);
    const formattedItems = items.map((item) => {
      let status = item.status;
      if (status === QuotationStatus.SENT && item.validUntil && new Date(item.validUntil).getTime() < nowTs) {
        status = QuotationStatus.EXPIRED;
      }
      return {
        ...item,
        status
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      quotations: formattedItems.map(decryptQuotation),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      summary: {
        totalQuotations: summaryAgg._count.id || 0,
        totalValue: toNumber(summaryAgg._sum.grandTotal || 0),
        draftCount: countsMap[QuotationStatus.DRAFT] || 0,
        sentCount: countsMap[QuotationStatus.SENT] || 0,
        acceptedCount: countsMap[QuotationStatus.ACCEPTED] || 0,
        convertedCount: countsMap[QuotationStatus.CONVERTED] || 0,
        rejectedCount: countsMap[QuotationStatus.REJECTED] || 0,
        cancelledCount: countsMap[QuotationStatus.CANCELLED] || 0
      }
    };
  }

  /**
   * Deletes a quotation (only DRAFT, CANCELLED, or REJECTED).
   */
  static async delete(companyId: string, quotationId: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Converted quotations cannot be deleted');
    }

    if (existing.status === QuotationStatus.SENT || existing.status === QuotationStatus.ACCEPTED) {
      throw AppError.badRequest(`Cannot delete a quotation in ${existing.status} status. Cancel it first.`);
    }

    await prisma.quotation.delete({
      where: { id: existing.id }
    });

    return { success: true };
  }

  /**
   * Marks a quotation as SENT.
   */
  static async send(companyId: string, quotationId: string, userId?: string, ipAddress?: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Cannot send a converted quotation');
    }

    if (existing.status === QuotationStatus.CANCELLED) {
      throw AppError.badRequest('Cannot send a cancelled quotation');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          status: QuotationStatus.SENT,
          sentAt: new Date()
        }
      });

      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: res.id,
          userId: userId || null,
          action: ActivityType.SENT,
          description: `Marked as Sent to ${res.billingName}`,
          metadata: {
            quotationNumber: res.quotationNumber,
            sentAt: new Date().toISOString()
          },
          ipAddress: ipAddress || null
        }
      });

      return res;
    });

    return updated;
  }

  /**
   * Marks a quotation as ACCEPTED.
   */
  static async accept(companyId: string, quotationId: string, userId?: string, ipAddress?: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Quotation is already converted to an invoice');
    }

    if (existing.status === QuotationStatus.CANCELLED) {
      throw AppError.badRequest('Cannot accept a cancelled quotation');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          status: QuotationStatus.ACCEPTED,
          acceptedAt: new Date()
        }
      });

      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: res.id,
          userId: userId || null,
          action: ActivityType.STATUS_CHANGED,
          description: `Accepted by customer`,
          metadata: {
            from: existing.status,
            to: QuotationStatus.ACCEPTED
          },
          ipAddress: ipAddress || null
        }
      });

      return res;
    });

    return updated;
  }

  /**
   * Marks a quotation as REJECTED.
   */
  static async reject(companyId: string, quotationId: string, reason?: string, userId?: string, ipAddress?: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Cannot reject a converted quotation');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          status: QuotationStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: reason?.trim() || null
        }
      });

      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: res.id,
          userId: userId || null,
          action: ActivityType.STATUS_CHANGED,
          description: `Rejected${reason ? `: ${reason}` : ''}`,
          metadata: {
            from: existing.status,
            to: QuotationStatus.REJECTED,
            reason
          },
          ipAddress: ipAddress || null
        }
      });

      return res;
    });

    return updated;
  }

  /**
   * Cancels a quotation.
   */
  static async cancel(companyId: string, quotationId: string, reason?: string, userId?: string, ipAddress?: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId }
    });

    if (!existing) {
      throw AppError.notFound('Quotation not found');
    }

    if (existing.status === QuotationStatus.CONVERTED) {
      throw AppError.badRequest('Cannot cancel a quotation that has already been converted to an invoice');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          status: QuotationStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledReason: reason?.trim() || null
        }
      });

      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: res.id,
          userId: userId || null,
          action: ActivityType.CANCELLED,
          description: `Cancelled${reason ? `: ${reason}` : ''}`,
          metadata: {
            from: existing.status,
            to: QuotationStatus.CANCELLED,
            reason
          },
          ipAddress: ipAddress || null
        }
      });

      return res;
    });

    return updated;
  }

  /**
   * Duplicates a quotation into a new DRAFT quotation.
   */
  static async duplicate(companyId: string, quotationId: string, userId?: string, ipAddress?: string) {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: { items: true }
    });

    if (!existing) {
      throw AppError.notFound('Quotation to duplicate was not found');
    }

    const payload: CreateQuotationInput = {
      customerId: existing.customerId,
      subject: existing.subject ? `Copy of ${existing.subject}` : `Copy of ${existing.quotationNumber}`,
      inquiryNumber: existing.inquiryNumber,
      inquiryDate: existing.inquiryDate,
      referenceNumber: existing.referenceNumber,
      quotationDate: new Date(),
      paymentTerms: existing.paymentTerms,
      currency: existing.currency,

      billingName: existing.billingName,
      billingEmail: existing.billingEmail,
      billingPhone: existing.billingPhone,
      billingGstin: existing.billingGstin,
      billingAddress: existing.billingAddress,
      billingCity: existing.billingCity,
      billingState: existing.billingState,
      billingCountry: existing.billingCountry,
      billingPostalCode: existing.billingPostalCode,

      placeOfSupply: existing.placeOfSupply,
      forwardingPackagingAmount: toNumber(existing.forwardingPackagingAmount),
      notes: existing.notes,
      terms: existing.terms,
      status: QuotationStatus.DRAFT,
      items: existing.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        description: i.description,
        hsnSacCode: i.hsnSacCode,
        unit: i.unit,
        quantity: toNumber(i.quantity),
        rate: toNumber(i.rate),
        discountPercent: toNumber(i.discountPercent),
        taxRate: toNumber(i.taxRate)
      }))
    };

    const created = await this.create(companyId, payload, userId, ipAddress);

    // Record duplication activity on the original quotation
    await prisma.quotationActivity.create({
      data: {
        companyId,
        quotationId: existing.id,
        userId: userId || null,
        action: ActivityType.DUPLICATED,
        description: `Duplicated as new quotation ${created.quotationNumber}`,
        metadata: {
          newQuotationId: created.id,
          newQuotationNumber: created.quotationNumber
        },
        ipAddress: ipAddress || null
      }
    });

    return created;
  }

  /**
   * Converts a quotation to a Tax Invoice.
   * Creates invoice, invoice line items, links invoice to quotation, sets status to CONVERTED.
   */
  static async convertToInvoice(companyId: string, quotationId: string, userId?: string, ipAddress?: string) {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        customer: true
      }
    });

    if (!quotation) {
      throw AppError.notFound('Quotation not found');
    }

    if (quotation.status === QuotationStatus.CONVERTED && quotation.convertedInvoiceId) {
      throw AppError.badRequest('This quotation has already been converted to an invoice');
    }

    if (quotation.status === QuotationStatus.CANCELLED) {
      throw AppError.badRequest('Cannot convert a cancelled quotation');
    }

    if (quotation.status === QuotationStatus.REJECTED) {
      throw AppError.badRequest('Cannot convert a rejected quotation');
    }

    // Need a customer record to create an invoice in Invoice Maker
    let customerId = quotation.customerId;
    if (!customerId) {
      // If customer was a direct typed name, locate or create a customer
      const existingCustomer = await prisma.customer.findFirst({
        where: { companyId, name: quotation.billingName }
      });
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const createdCustomer = await prisma.customer.create({
          data: {
            companyId,
            name: quotation.billingName,
            email: quotation.billingEmail,
            phone: quotation.billingPhone,
            gstin: quotation.billingGstin ? encryptField(decryptField(quotation.billingGstin)) : null,
            address: quotation.billingAddress,
            city: quotation.billingCity,
            state: quotation.billingState,
            country: quotation.billingCountry || 'India',
            postalCode: quotation.billingPostalCode
          }
        });
        customerId = createdCustomer.id;
      }
    }

    const invoiceDate = new Date();
    const financialYear = financialYearOf(invoiceDate);

    const invoiceSettings = await InvoiceSettingsService.getOrCreate(companyId);
    const dueDays = invoiceSettings.defaultDueDays || 15;
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + dueDays);

    const invoice = await prisma.$transaction(async (tx) => {
      // Atomically allocate next invoice number inside transaction
      const allocatedInvoice = await NumberingService.allocate(tx, companyId, DocumentType.INVOICE, invoiceDate);

      // 1. Create Invoice
      const createdInvoice = await tx.invoice.create({
        data: {
          companyId,
          customerId: customerId!,
          invoiceNumber: allocatedInvoice.number,
          sequenceNo: allocatedInvoice.sequenceNo,
          financialYear,
          billType: 'Tax Invoice',
          issueDate: invoiceDate,
          dueDate,
          reference: quotation.quotationNumber,
          paymentTerms: quotation.paymentTerms || '50% Advance',
          currency: quotation.currency || 'INR',

          billingName: quotation.billingName,
          billingEmail: quotation.billingEmail,
          billingPhone: quotation.billingPhone,
          billingGstin: decryptField(quotation.billingGstin),
          billingAddress: quotation.billingAddress,
          billingCity: quotation.billingCity,
          billingState: quotation.billingState,
          billingCountry: quotation.billingCountry,
          billingPostalCode: quotation.billingPostalCode,

          placeOfSupply: quotation.placeOfSupply,
          placeOfSupplyCode: quotation.placeOfSupplyCode,
          isIgst: quotation.isIgst,

          subtotal: quotation.subtotal,
          discountAmount: quotation.discountAmount,
          taxableAmount: quotation.taxableAmount,
          cgstAmount: quotation.cgstAmount,
          sgstAmount: quotation.sgstAmount,
          igstAmount: quotation.igstAmount,
          taxAmount: quotation.taxAmount,
          extraCharges: quotation.forwardingPackagingAmount,
          roundOff: quotation.roundOff,
          grandTotal: quotation.grandTotal,
          balanceDue: quotation.grandTotal,
          amountPaid: new Prisma.Decimal(0),

          notes: quotation.notes,
          terms: quotation.terms,
          status: InvoiceStatus.DRAFT,

          items: {
            create: quotation.items.map((qi, idx) => ({
              productId: qi.productId,
              name: qi.name,
              description: qi.description,
              hsnSacCode: qi.hsnSacCode,
              unit: qi.unit,
              sortOrder: idx,
              quantity: qi.quantity,
              unitPrice: qi.rate,
              discountPercent: qi.discountPercent,
              discountAmount: qi.discountAmount,
              taxRate: qi.taxRate,
              subtotal: qi.subtotal,
              taxableAmount: qi.taxableAmount,
              cgstRate: qi.cgstRate,
              cgstAmount: qi.cgstAmount,
              sgstRate: qi.sgstRate,
              sgstAmount: qi.sgstAmount,
              igstRate: qi.igstRate,
              igstAmount: qi.igstAmount,
              taxAmount: qi.taxAmount,
              total: qi.amount
            }))
          }
        }
      });

      // 2. Mark Quotation as CONVERTED and link to new Invoice
      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          status: QuotationStatus.CONVERTED,
          convertedInvoiceId: createdInvoice.id,
          convertedAt: new Date()
        }
      });

      // 3. Log activity on Quotation
      await tx.quotationActivity.create({
        data: {
          companyId,
          quotationId: quotation.id,
          userId: userId || null,
          action: ActivityType.STATUS_CHANGED,
          description: `Quotation converted to Tax Invoice ${createdInvoice.invoiceNumber}`,
          metadata: {
            invoiceId: createdInvoice.id,
            invoiceNumber: createdInvoice.invoiceNumber
          },
          ipAddress: ipAddress || null
        }
      });

      // 4. Log activity on created Invoice
      await tx.invoiceActivity.create({
        data: {
          companyId,
          invoiceId: createdInvoice.id,
          userId: userId || null,
          action: ActivityType.CREATED,
          description: `Created from Quotation ${quotation.quotationNumber}`,
          metadata: {
            quotationId: quotation.id,
            quotationNumber: quotation.quotationNumber
          },
          ipAddress: ipAddress || null
        }
      });

      return createdInvoice;
    });

    return invoice;
  }
}
