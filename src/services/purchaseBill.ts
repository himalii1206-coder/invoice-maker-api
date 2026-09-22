import { Prisma, PurchaseBillStatus, ItcEligibility, ItemCategory, PaymentMethod, DocumentType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';
import { round2, toNumber, toPaise, fromPaise } from '../utils/money.js';
import { financialYearOf, addDays } from '../utils/date.js';
import { computeDocument, resolveSupply, TaxLineInput } from './tax.js';
import { NumberingService } from './numbering.js';

export interface PurchaseBillItemInput {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  category?: ItemCategory;
  unit?: string;
  sortOrder?: number;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
}

export interface CreatePurchaseBillInput {
  vendorId?: string | null;
  billNumber?: string;
  vendorInvoiceNumber: string;
  status?: PurchaseBillStatus;
  billDate?: Date | string;
  dueDate?: Date | string;
  paymentTerms?: string;
  currency?: string;

  // Logistics
  poNumber?: string;
  poDate?: Date | string;
  grnNumber?: string;
  grnDate?: Date | string;
  transporterName?: string;
  vehicleNumber?: string;
  lrNumber?: string;
  lrDate?: Date | string;

  // Vendor snapshot
  vendorName: string;
  vendorGstin?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  vendorAddress?: string;
  vendorCity?: string;
  vendorState?: string;
  vendorCountry?: string;
  vendorPostalCode?: string;

  // Tax
  placeOfSupply?: string;
  placeOfSupplyCode?: string;
  isIgst?: boolean;
  isReverseCharge?: boolean;
  itcEligibility?: ItcEligibility;

  otherCharges?: number;
  roundOff?: number;

  notes?: string;
  terms?: string;
  internalNotes?: string;
  attachmentUrl?: string;

  items: PurchaseBillItemInput[];
}

export type UpdatePurchaseBillInput = Partial<CreatePurchaseBillInput>;

export interface ListPurchaseBillsQuery {
  page: number;
  limit: number;
  search?: string;
  vendorId?: string;
  status?: PurchaseBillStatus;
  financialYear?: string;
  startDate?: Date;
  endDate?: Date;
  sortBy: 'billDate' | 'dueDate' | 'grandTotal' | 'balanceDue' | 'billNumber' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

export interface RecordPurchasePaymentInput {
  amount: number;
  paymentDate?: Date | string;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
}

const purchaseBillItemSelect = {
  id: true,
  productId: true,
  name: true,
  description: true,
  hsnSacCode: true,
  category: true,
  unit: true,
  sortOrder: true,
  quantity: true,
  unitPrice: true,
  discountPercent: true,
  discountAmount: true,
  taxRate: true,
  subtotal: true,
  taxableAmount: true,
  cgstRate: true,
  cgstAmount: true,
  sgstRate: true,
  sgstAmount: true,
  igstRate: true,
  igstAmount: true,
  taxAmount: true,
  total: true
} as const;

const purchaseBillSelect = {
  id: true,
  companyId: true,
  vendorId: true,
  billNumber: true,
  vendorInvoiceNumber: true,
  sequenceNo: true,
  financialYear: true,
  status: true,
  billDate: true,
  dueDate: true,
  paymentTerms: true,
  currency: true,
  poNumber: true,
  poDate: true,
  grnNumber: true,
  grnDate: true,
  transporterName: true,
  vehicleNumber: true,
  lrNumber: true,
  lrDate: true,
  vendorName: true,
  vendorGstin: true,
  vendorPhone: true,
  vendorEmail: true,
  vendorAddress: true,
  vendorCity: true,
  vendorState: true,
  vendorCountry: true,
  vendorPostalCode: true,
  placeOfSupply: true,
  placeOfSupplyCode: true,
  isIgst: true,
  isReverseCharge: true,
  itcEligibility: true,
  subtotal: true,
  discountAmount: true,
  taxableAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  taxAmount: true,
  otherCharges: true,
  roundOff: true,
  grandTotal: true,
  amountPaid: true,
  balanceDue: true,
  notes: true,
  terms: true,
  internalNotes: true,
  attachmentUrl: true,
  createdAt: true,
  updatedAt: true,
  vendor: {
    select: {
      id: true,
      name: true,
      tradeName: true,
      email: true,
      phone: true,
      gstin: true,
      city: true,
      state: true
    }
  },
  items: {
    select: purchaseBillItemSelect,
    orderBy: { sortOrder: 'asc' as const }
  },
  payments: {
    orderBy: { paymentDate: 'desc' as const },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      referenceNumber: true,
      notes: true,
      createdAt: true
    }
  }
} as const;

export class PurchaseBillService {
  static async create(companyId: string, input: CreatePurchaseBillInput) {
    if (!input.items || input.items.length === 0) {
      throw AppError.badRequest('A purchase bill must have at least one line item');
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { state: true, gstin: true, name: true }
    });

    if (!company) {
      throw AppError.notFound('Company not found');
    }

    // Auto-resolve vendor details if vendorId is provided
    let vendorSnapshot = {
      vendorName: input.vendorName || '',
      vendorGstin: input.vendorGstin || null,
      vendorPhone: input.vendorPhone || null,
      vendorEmail: input.vendorEmail || null,
      vendorAddress: input.vendorAddress || null,
      vendorCity: input.vendorCity || null,
      vendorState: input.vendorState || null,
      vendorCountry: input.vendorCountry || 'India',
      vendorPostalCode: input.vendorPostalCode || null
    };

    if (input.vendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { id: input.vendorId, companyId }
      });
      if (vendor) {
        vendorSnapshot = {
          vendorName: vendorSnapshot.vendorName || vendor.name,
          vendorGstin: vendorSnapshot.vendorGstin || vendor.gstin || null,
          vendorPhone: vendorSnapshot.vendorPhone || vendor.phone || null,
          vendorEmail: vendorSnapshot.vendorEmail || vendor.email || null,
          vendorAddress: vendorSnapshot.vendorAddress || vendor.address || null,
          vendorCity: vendorSnapshot.vendorCity || vendor.city || null,
          vendorState: vendorSnapshot.vendorState || vendor.state || null,
          vendorCountry: vendorSnapshot.vendorCountry || vendor.country || 'India',
          vendorPostalCode: vendorSnapshot.vendorPostalCode || vendor.postalCode || null
        };
      }
    }

    const billDate = input.billDate ? new Date(input.billDate) : new Date();
    const fy = financialYearOf(billDate);

    // Auto calculate supply location (Intrastate CGST+SGST vs Interstate IGST)
    const supply = resolveSupply(
      company.state,
      company.gstin,
      input.placeOfSupply || vendorSnapshot.vendorState || company.state
    );
    const isIgst = input.isIgst !== undefined ? input.isIgst : supply.isIgst;

    // Compute lines & document totals with tax engine
    const doc = computeDocument(
      input.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountPercent: i.discountPercent ?? 0,
        taxRate: i.taxRate ?? 0
      })),
      { isIgst, enableRoundOff: true }
    );

    const otherCharges = round2(input.otherCharges ?? 0);
    const roundOff = round2(input.roundOff !== undefined ? input.roundOff : doc.roundOff);
    const grandTotal = round2(doc.taxableAmount + doc.taxAmount + otherCharges + roundOff);

    // Numbering: generate internal PB voucher number if not provided
    let billNumber = input.billNumber?.trim();
    let sequenceNo = 0;

    if (!billNumber) {
      const seq = await prisma.documentSequence.upsert({
        where: {
          companyId_documentType_periodKey: {
            companyId,
            documentType: DocumentType.PURCHASE_BILL,
            periodKey: fy
          }
        },
        create: {
          companyId,
          documentType: DocumentType.PURCHASE_BILL,
          periodKey: fy,
          nextNumber: 2
        },
        update: {
          nextNumber: { increment: 1 }
        }
      });
      sequenceNo = seq.nextNumber - 1;
      billNumber = `PB-${fy}-${String(sequenceNo).padStart(4, '0')}`;
    }

    const dueDate = input.dueDate ? new Date(input.dueDate) : addDays(billDate, 30);

    const purchaseBill = await prisma.$transaction(
      async (tx) => {
        const created = await tx.purchaseBill.create({
          data: {
            companyId,
            vendorId: input.vendorId || null,
            billNumber,
            vendorInvoiceNumber: input.vendorInvoiceNumber?.trim() || null,
            sequenceNo,
            financialYear: fy,
            status: input.status || 'RECEIVED',
            billDate,
            dueDate,
            paymentTerms: input.paymentTerms || 'Net 30 Days',
            currency: input.currency || 'INR',

            poNumber: input.poNumber || null,
            poDate: input.poDate ? new Date(input.poDate) : null,
            grnNumber: input.grnNumber || null,
            grnDate: input.grnDate ? new Date(input.grnDate) : null,
            transporterName: input.transporterName || null,
            vehicleNumber: input.vehicleNumber || null,
            lrNumber: input.lrNumber || null,
            lrDate: input.lrDate ? new Date(input.lrDate) : null,

            vendorName: vendorSnapshot.vendorName,
            vendorGstin: vendorSnapshot.vendorGstin,
            vendorPhone: vendorSnapshot.vendorPhone,
            vendorEmail: vendorSnapshot.vendorEmail,
            vendorAddress: vendorSnapshot.vendorAddress,
            vendorCity: vendorSnapshot.vendorCity,
            vendorState: vendorSnapshot.vendorState,
            vendorCountry: vendorSnapshot.vendorCountry,
            vendorPostalCode: vendorSnapshot.vendorPostalCode,

            placeOfSupply: input.placeOfSupply || supply.placeOfSupply,
            placeOfSupplyCode: input.placeOfSupplyCode || supply.placeOfSupplyCode,
            isIgst,
            isReverseCharge: input.isReverseCharge ?? false,
            itcEligibility: input.itcEligibility || 'INPUTS',

            subtotal: new Prisma.Decimal(doc.subtotal),
            discountAmount: new Prisma.Decimal(doc.discountAmount),
            taxableAmount: new Prisma.Decimal(doc.taxableAmount),
            cgstAmount: new Prisma.Decimal(doc.cgstAmount),
            sgstAmount: new Prisma.Decimal(doc.sgstAmount),
            igstAmount: new Prisma.Decimal(doc.igstAmount),
            taxAmount: new Prisma.Decimal(doc.taxAmount),
            otherCharges: new Prisma.Decimal(otherCharges),
            roundOff: new Prisma.Decimal(roundOff),
            grandTotal: new Prisma.Decimal(grandTotal),
            amountPaid: new Prisma.Decimal(0),
            balanceDue: new Prisma.Decimal(grandTotal),

            notes: input.notes || null,
            terms: input.terms || null,
            internalNotes: input.internalNotes || null,
            attachmentUrl: input.attachmentUrl || null,

            items: {
              create: input.items.map((item, idx) => {
                const line = doc.lines[idx];
                return {
                  productId: item.productId || null,
                  name: item.name.trim(),
                  description: item.description?.trim() || null,
                  hsnSacCode: item.hsnSacCode?.trim() || null,
                  category: item.category || 'GOODS',
                  unit: item.unit?.trim() || 'PCS',
                  sortOrder: item.sortOrder ?? idx,
                  quantity: new Prisma.Decimal(line.quantity),
                  unitPrice: new Prisma.Decimal(line.unitPrice),
                  discountPercent: new Prisma.Decimal(line.discountPercent),
                  discountAmount: new Prisma.Decimal(line.discountAmount),
                  taxRate: new Prisma.Decimal(line.taxRate),
                  subtotal: new Prisma.Decimal(line.subtotal),
                  taxableAmount: new Prisma.Decimal(line.taxableAmount),
                  cgstRate: new Prisma.Decimal(line.cgstRate),
                  cgstAmount: new Prisma.Decimal(line.cgstAmount),
                  sgstRate: new Prisma.Decimal(line.sgstRate),
                  sgstAmount: new Prisma.Decimal(line.sgstAmount),
                  igstRate: new Prisma.Decimal(line.igstRate),
                  igstAmount: new Prisma.Decimal(line.igstAmount),
                  taxAmount: new Prisma.Decimal(line.taxAmount),
                  total: new Prisma.Decimal(line.total)
                };
              })
            }
          },
          select: purchaseBillSelect
        });

        return created;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return purchaseBill;
  }

  static async findById(companyId: string, id: string) {
    const bill = await prisma.purchaseBill.findFirst({
      where: { id, companyId },
      select: purchaseBillSelect
    });

    if (!bill) {
      throw AppError.notFound('Purchase Bill not found');
    }

    return bill;
  }

  static async list(companyId: string, query: ListPurchaseBillsQuery) {
    const { page, limit, search, vendorId, status, financialYear, startDate, endDate, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseBillWhereInput = {
      companyId,
      ...(vendorId ? { vendorId } : {}),
      ...(status ? { status } : {}),
      ...(financialYear ? { financialYear } : {}),
      ...(startDate || endDate
        ? {
            billDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          }
        : {}),
      ...(search
        ? {
            OR: [
              { billNumber: { contains: search, mode: 'insensitive' } },
              { vendorInvoiceNumber: { contains: search, mode: 'insensitive' } },
              { vendorName: { contains: search, mode: 'insensitive' } },
              { poNumber: { contains: search, mode: 'insensitive' } },
              { grnNumber: { contains: search, mode: 'insensitive' } },
              { vendorGstin: { contains: search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const [total, purchaseBills] = await Promise.all([
      prisma.purchaseBill.count({ where }),
      prisma.purchaseBill.findMany({
        where,
        select: purchaseBillSelect,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };

    return { purchaseBills, meta };
  }

  static async update(companyId: string, id: string, input: UpdatePurchaseBillInput) {
    const existing = await this.findById(companyId, id);

    const billDate = input.billDate ? new Date(input.billDate) : existing.billDate;
    const fy = financialYearOf(billDate);

    const isIgst = input.isIgst !== undefined ? input.isIgst : existing.isIgst;

    let doc = null;
    let otherCharges = toNumber(existing.otherCharges);
    let roundOff = toNumber(existing.roundOff);
    let grandTotal = toNumber(existing.grandTotal);

    if (input.items && input.items.length > 0) {
      doc = computeDocument(
        input.items.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountPercent: i.discountPercent ?? 0,
          taxRate: i.taxRate ?? 0
        })),
        { isIgst, enableRoundOff: true }
      );
      otherCharges = round2(input.otherCharges !== undefined ? input.otherCharges : toNumber(existing.otherCharges));
      roundOff = round2(input.roundOff !== undefined ? input.roundOff : doc.roundOff);
      grandTotal = round2(doc.taxableAmount + doc.taxAmount + otherCharges + roundOff);
    }

    const amountPaid = toNumber(existing.amountPaid);
    const balanceDue = round2(Math.max(0, grandTotal - amountPaid));

    let status = existing.status;
    if (input.status) {
      status = input.status;
    } else if (balanceDue <= 0 && grandTotal > 0) {
      status = 'PAID';
    } else if (amountPaid > 0) {
      status = 'PARTIALLY_PAID';
    }

    const updated = await prisma.$transaction(
      async (tx) => {
        if (input.items && input.items.length > 0 && doc) {
          await tx.purchaseBillItem.deleteMany({ where: { purchaseBillId: id } });
        }

        return tx.purchaseBill.update({
          where: { id },
          data: {
            ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
            ...(input.vendorInvoiceNumber !== undefined ? { vendorInvoiceNumber: input.vendorInvoiceNumber } : {}),
            ...(input.billNumber !== undefined ? { billNumber: input.billNumber } : {}),
            ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
            ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
            ...(input.billDate !== undefined ? { billDate, financialYear: fy } : {}),
            ...(input.poNumber !== undefined ? { poNumber: input.poNumber } : {}),
            ...(input.poDate !== undefined ? { poDate: input.poDate ? new Date(input.poDate) : null } : {}),
            ...(input.grnNumber !== undefined ? { grnNumber: input.grnNumber } : {}),
            ...(input.grnDate !== undefined ? { grnDate: input.grnDate ? new Date(input.grnDate) : null } : {}),
            ...(input.transporterName !== undefined ? { transporterName: input.transporterName } : {}),
            ...(input.vehicleNumber !== undefined ? { vehicleNumber: input.vehicleNumber } : {}),
            ...(input.lrNumber !== undefined ? { lrNumber: input.lrNumber } : {}),
            ...(input.lrDate !== undefined ? { lrDate: input.lrDate ? new Date(input.lrDate) : null } : {}),
            ...(input.vendorName !== undefined ? { vendorName: input.vendorName } : {}),
            ...(input.vendorGstin !== undefined ? { vendorGstin: input.vendorGstin } : {}),
            ...(input.vendorPhone !== undefined ? { vendorPhone: input.vendorPhone } : {}),
            ...(input.vendorEmail !== undefined ? { vendorEmail: input.vendorEmail } : {}),
            ...(input.vendorAddress !== undefined ? { vendorAddress: input.vendorAddress } : {}),
            ...(input.vendorCity !== undefined ? { vendorCity: input.vendorCity } : {}),
            ...(input.vendorState !== undefined ? { vendorState: input.vendorState } : {}),
            ...(input.placeOfSupply !== undefined ? { placeOfSupply: input.placeOfSupply } : {}),
            ...(input.placeOfSupplyCode !== undefined ? { placeOfSupplyCode: input.placeOfSupplyCode } : {}),
            ...(input.isIgst !== undefined ? { isIgst: input.isIgst } : {}),
            ...(input.isReverseCharge !== undefined ? { isReverseCharge: input.isReverseCharge } : {}),
            ...(input.itcEligibility !== undefined ? { itcEligibility: input.itcEligibility } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.terms !== undefined ? { terms: input.terms } : {}),
            ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
            ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl } : {}),
            status,
            ...(doc
              ? {
                  subtotal: new Prisma.Decimal(doc.subtotal),
                  discountAmount: new Prisma.Decimal(doc.discountAmount),
                  taxableAmount: new Prisma.Decimal(doc.taxableAmount),
                  cgstAmount: new Prisma.Decimal(doc.cgstAmount),
                  sgstAmount: new Prisma.Decimal(doc.sgstAmount),
                  igstAmount: new Prisma.Decimal(doc.igstAmount),
                  taxAmount: new Prisma.Decimal(doc.taxAmount),
                  otherCharges: new Prisma.Decimal(otherCharges),
                  roundOff: new Prisma.Decimal(roundOff),
                  grandTotal: new Prisma.Decimal(grandTotal),
                  balanceDue: new Prisma.Decimal(balanceDue),
                  items: {
                    create: input.items!.map((item, idx) => {
                      const line = doc!.lines[idx];
                      return {
                        productId: item.productId || null,
                        name: item.name.trim(),
                        description: item.description?.trim() || null,
                        hsnSacCode: item.hsnSacCode?.trim() || null,
                        category: item.category || 'GOODS',
                        unit: item.unit?.trim() || 'PCS',
                        sortOrder: item.sortOrder ?? idx,
                        quantity: new Prisma.Decimal(line.quantity),
                        unitPrice: new Prisma.Decimal(line.unitPrice),
                        discountPercent: new Prisma.Decimal(line.discountPercent),
                        discountAmount: new Prisma.Decimal(line.discountAmount),
                        taxRate: new Prisma.Decimal(line.taxRate),
                        subtotal: new Prisma.Decimal(line.subtotal),
                        taxableAmount: new Prisma.Decimal(line.taxableAmount),
                        cgstRate: new Prisma.Decimal(line.cgstRate),
                        cgstAmount: new Prisma.Decimal(line.cgstAmount),
                        sgstRate: new Prisma.Decimal(line.sgstRate),
                        sgstAmount: new Prisma.Decimal(line.sgstAmount),
                        igstRate: new Prisma.Decimal(line.igstRate),
                        igstAmount: new Prisma.Decimal(line.igstAmount),
                        taxAmount: new Prisma.Decimal(line.taxAmount),
                        total: new Prisma.Decimal(line.total)
                      };
                    })
                  }
                }
              : {})
          },
          select: purchaseBillSelect
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return updated;
  }

  static async delete(companyId: string, id: string) {
    const bill = await this.findById(companyId, id);

    if (bill.payments.length > 0) {
      throw AppError.badRequest('Cannot delete a purchase bill with recorded vendor payments. Delete the payments first.');
    }

    await prisma.purchaseBill.delete({
      where: { id }
    });

    return { message: 'Purchase bill deleted successfully' };
  }

  static async recordPayment(companyId: string, id: string, input: RecordPurchasePaymentInput) {
    const bill = await this.findById(companyId, id);

    const paymentAmount = round2(input.amount);
    const balanceDueBefore = toNumber(bill.balanceDue);

    if (paymentAmount <= 0) {
      throw AppError.badRequest('Payment amount must be greater than zero');
    }

    if (paymentAmount > balanceDueBefore) {
      throw AppError.badRequest(`Payment amount (₹${paymentAmount}) cannot exceed balance due (₹${balanceDueBefore})`);
    }

    const currentPaid = toNumber(bill.amountPaid);
    const grandTotal = toNumber(bill.grandTotal);
    const newAmountPaid = round2(currentPaid + paymentAmount);
    const newBalanceDue = round2(Math.max(0, grandTotal - newAmountPaid));

    const newStatus: PurchaseBillStatus = newBalanceDue <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    const result = await prisma.$transaction(
      async (tx) => {
        const payment = await tx.purchasePayment.create({
          data: {
            companyId,
            purchaseBillId: id,
            vendorId: bill.vendorId,
            amount: new Prisma.Decimal(paymentAmount),
            paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
            paymentMethod: input.paymentMethod || 'BANK_TRANSFER',
            referenceNumber: input.referenceNumber || null,
            notes: input.notes || null
          }
        });

        const updatedBill = await tx.purchaseBill.update({
          where: { id },
          data: {
            amountPaid: new Prisma.Decimal(newAmountPaid),
            balanceDue: new Prisma.Decimal(newBalanceDue),
            status: newStatus
          },
          select: purchaseBillSelect
        });

        return { payment, purchaseBill: updatedBill };
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return result;
  }

  static async deletePayment(companyId: string, billId: string, paymentId: string) {
    const bill = await this.findById(companyId, billId);

    const payment = await prisma.purchasePayment.findFirst({
      where: { id: paymentId, purchaseBillId: billId, companyId }
    });

    if (!payment) {
      throw AppError.notFound('Payment not found');
    }

    const paymentAmount = toNumber(payment.amount);
    const currentPaid = toNumber(bill.amountPaid);
    const grandTotal = toNumber(bill.grandTotal);
    const newAmountPaid = round2(Math.max(0, currentPaid - paymentAmount));
    const newBalanceDue = round2(Math.min(grandTotal, grandTotal - newAmountPaid));

    const newStatus: PurchaseBillStatus = newAmountPaid <= 0 ? 'RECEIVED' : 'PARTIALLY_PAID';

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.purchasePayment.delete({ where: { id: paymentId } });

        const updatedBill = await tx.purchaseBill.update({
          where: { id: billId },
          data: {
            amountPaid: new Prisma.Decimal(newAmountPaid),
            balanceDue: new Prisma.Decimal(newBalanceDue),
            status: newStatus
          },
          select: purchaseBillSelect
        });

        return updatedBill;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return result;
  }

  static async getDashboardMetrics(companyId: string, financialYear?: string) {
    const where: Prisma.PurchaseBillWhereInput = {
      companyId,
      status: { not: 'CANCELLED' },
      ...(financialYear ? { financialYear } : {})
    };

    const bills = await prisma.purchaseBill.findMany({
      where,
      select: {
        grandTotal: true,
        amountPaid: true,
        balanceDue: true,
        taxAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        taxableAmount: true,
        status: true,
        dueDate: true
      }
    });

    const now = new Date();

    let totalPurchases = 0;
    let totalPaid = 0;
    let outstandingPayables = 0;
    let overduePayables = 0;
    let totalItcTax = 0;
    let totalTaxableTurnover = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const b of bills) {
      const g = toNumber(b.grandTotal);
      const p = toNumber(b.amountPaid);
      const bal = toNumber(b.balanceDue);
      const tax = toNumber(b.taxAmount);

      totalPurchases += g;
      totalPaid += p;
      outstandingPayables += bal;
      totalItcTax += tax;
      totalTaxableTurnover += toNumber(b.taxableAmount);
      totalCgst += toNumber(b.cgstAmount);
      totalSgst += toNumber(b.sgstAmount);
      totalIgst += toNumber(b.igstAmount);

      if (bal > 0 && b.dueDate && new Date(b.dueDate) < now) {
        overduePayables += bal;
      }
    }

    return {
      totalPurchases: round2(totalPurchases),
      totalPaid: round2(totalPaid),
      outstandingPayables: round2(outstandingPayables),
      overduePayables: round2(overduePayables),
      billCount: bills.length,
      itcSummary: {
        taxableTurnover: round2(totalTaxableTurnover),
        totalItc: round2(totalItcTax),
        cgst: round2(totalCgst),
        sgst: round2(totalSgst),
        igst: round2(totalIgst)
      }
    };
  }
}
