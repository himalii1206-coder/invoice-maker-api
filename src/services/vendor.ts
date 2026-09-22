import { Prisma, CustomerType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';

export interface CreateVendorInput {
  name: string;
  tradeName?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  type?: CustomerType;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  branch?: string;
  openingBalance?: number | Prisma.Decimal;
  openingBalanceDate?: Date | string;
  balanceType?: string;
  paymentTerms?: string;
  partyCategory?: string;
  narration?: string;
  isActive?: boolean;
}

export type UpdateVendorInput = Partial<CreateVendorInput>;

export interface ListVendorsQuery {
  page: number;
  limit: number;
  search?: string;
  type?: CustomerType;
  isActive?: boolean;
  city?: string;
  state?: string;
  sortBy: 'name' | 'email' | 'city' | 'state' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

const vendorSelect = {
  id: true,
  name: true,
  tradeName: true,
  contactPerson: true,
  email: true,
  phone: true,
  type: true,
  gstin: true,
  pan: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  bankName: true,
  accountNumber: true,
  ifscCode: true,
  branch: true,
  openingBalance: true,
  openingBalanceDate: true,
  balanceType: true,
  paymentTerms: true,
  partyCategory: true,
  narration: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

export class VendorService {
  static async create(companyId: string, input: CreateVendorInput) {
    const data: Prisma.VendorCreateInput = {
      name: input.name.trim(),
      tradeName: input.tradeName?.trim() || null,
      contactPerson: input.contactPerson?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      type: input.type ?? 'BUSINESS',
      gstin: input.gstin?.trim().toUpperCase() || null,
      pan: input.pan?.trim().toUpperCase() || null,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      country: input.country?.trim() || 'India',
      postalCode: input.postalCode?.trim() || null,
      bankName: input.bankName?.trim() || null,
      accountNumber: input.accountNumber?.trim() || null,
      ifscCode: input.ifscCode?.trim().toUpperCase() || null,
      branch: input.branch?.trim() || null,
      openingBalance: input.openingBalance !== undefined ? new Prisma.Decimal(input.openingBalance) : new Prisma.Decimal(0),
      openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null,
      balanceType: input.balanceType?.trim() || 'CR',
      paymentTerms: input.paymentTerms?.trim() || null,
      partyCategory: input.partyCategory?.trim() || null,
      narration: input.narration?.trim() || null,
      isActive: input.isActive ?? true,
      company: { connect: { id: companyId } }
    };

    const vendor = await prisma.vendor.create({
      data,
      select: vendorSelect
    });

    return vendor;
  }

  static async findById(companyId: string, vendorId: string) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, companyId },
      select: {
        ...vendorSelect,
        purchaseBills: {
          take: 5,
          orderBy: { billDate: 'desc' },
          select: {
            id: true,
            billNumber: true,
            vendorInvoiceNumber: true,
            billDate: true,
            dueDate: true,
            grandTotal: true,
            balanceDue: true,
            status: true
          }
        },
        _count: {
          select: { purchaseBills: true }
        }
      }
    });

    if (!vendor) {
      throw AppError.notFound('Vendor not found');
    }

    return vendor;
  }

  static async list(companyId: string, query: ListVendorsQuery) {
    const { page, limit, search, type, isActive, city, state, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.VendorWhereInput = {
      companyId,
      ...(type ? { type } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      ...(state ? { state: { contains: state, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { tradeName: { contains: search, mode: 'insensitive' } },
              { contactPerson: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { gstin: { contains: search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        select: {
          ...vendorSelect,
          _count: {
            select: { purchaseBills: true }
          }
        },
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

    return { vendors, meta };
  }

  static async update(companyId: string, vendorId: string, input: UpdateVendorInput) {
    await this.findById(companyId, vendorId);

    const data: Prisma.VendorUpdateInput = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.tradeName !== undefined ? { tradeName: input.tradeName?.trim() || null } : {}),
      ...(input.contactPerson !== undefined ? { contactPerson: input.contactPerson?.trim() || null } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin?.trim().toUpperCase() || null } : {}),
      ...(input.pan !== undefined ? { pan: input.pan?.trim().toUpperCase() || null } : {}),
      ...(input.address !== undefined ? { address: input.address?.trim() || null } : {}),
      ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
      ...(input.state !== undefined ? { state: input.state?.trim() || null } : {}),
      ...(input.country !== undefined ? { country: input.country?.trim() || 'India' } : {}),
      ...(input.postalCode !== undefined ? { postalCode: input.postalCode?.trim() || null } : {}),
      ...(input.bankName !== undefined ? { bankName: input.bankName?.trim() || null } : {}),
      ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber?.trim() || null } : {}),
      ...(input.ifscCode !== undefined ? { ifscCode: input.ifscCode?.trim().toUpperCase() || null } : {}),
      ...(input.branch !== undefined ? { branch: input.branch?.trim() || null } : {}),
      ...(input.openingBalance !== undefined
        ? { openingBalance: input.openingBalance !== null ? new Prisma.Decimal(input.openingBalance) : null }
        : {}),
      ...(input.openingBalanceDate !== undefined
        ? { openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null }
        : {}),
      ...(input.balanceType !== undefined ? { balanceType: input.balanceType?.trim() || null } : {}),
      ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms?.trim() || null } : {}),
      ...(input.partyCategory !== undefined ? { partyCategory: input.partyCategory?.trim() || null } : {}),
      ...(input.narration !== undefined ? { narration: input.narration?.trim() || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
    };

    const updated = await prisma.vendor.update({
      where: { id: vendorId },
      data,
      select: vendorSelect
    });

    return updated;
  }

  static async delete(companyId: string, vendorId: string) {
    await this.findById(companyId, vendorId);

    const billsCount = await prisma.purchaseBill.count({
      where: { vendorId, companyId }
    });

    if (billsCount > 0) {
      throw AppError.badRequest(
        `Cannot delete vendor because ${billsCount} purchase bill(s) are linked to them. Mark the vendor as inactive instead.`
      );
    }

    await prisma.vendor.delete({
      where: { id: vendorId }
    });

    return { message: 'Vendor deleted successfully' };
  }
}
