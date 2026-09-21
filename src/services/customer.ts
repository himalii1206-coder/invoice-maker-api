import { Prisma, CustomerType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  type?: CustomerType;
  gstin?: string;
  address?: string;
  factoryAddress?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  officeNo?: string;
  contactPerson?: string;
  accountGroup?: string;
  openingBalance?: number | Prisma.Decimal;
  openingBalanceDate?: Date | string;
  balanceType?: string;
  partyCategory?: string;
  narration1?: string;
  narration2?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  isActive?: boolean;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface ListCustomersQuery {
  page: number;
  limit: number;
  search?: string;
  type?: CustomerType;
  isActive?: boolean;
  accountGroup?: string;
  partyCategory?: string;
  city?: string;
  state?: string;
  sortBy: 'name' | 'email' | 'city' | 'state' | 'accountGroup' | 'openingBalance' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

/** Shape returned to clients - keeps responses consistent across endpoints. */
const customerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  type: true,
  gstin: true,
  address: true,
  factoryAddress: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  officeNo: true,
  contactPerson: true,
  accountGroup: true,
  openingBalance: true,
  openingBalanceDate: true,
  balanceType: true,
  partyCategory: true,
  narration1: true,
  narration2: true,
  bankName: true,
  accountNumber: true,
  ifscCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.CustomerSelect;

export class CustomerService {
  /**
   * Every method takes companyId as its first argument and folds it into the
   * `where` clause, so a customer belonging to another business is invisible
   * rather than merely forbidden.
   */
  static async list(companyId: string, query: ListCustomersQuery) {
    const { page, limit, search, type, isActive, accountGroup, partyCategory, city, state, sortBy, sortOrder } = query;

    const where: Prisma.CustomerWhereInput = {
      companyId,
      ...(type && { type }),
      ...(isActive !== undefined && { isActive }),
      ...(accountGroup && { accountGroup: { equals: accountGroup, mode: 'insensitive' } }),
      ...(partyCategory && { partyCategory: { equals: partyCategory, mode: 'insensitive' } }),
      ...(city && { city: { equals: city, mode: 'insensitive' } }),
      ...(state && { state: { equals: state, mode: 'insensitive' } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search, mode: 'insensitive' as const } },
          { officeNo: { contains: search, mode: 'insensitive' as const } },
          { gstin: { contains: search, mode: 'insensitive' as const } },
          { city: { contains: search, mode: 'insensitive' as const } },
          { state: { contains: search, mode: 'insensitive' as const } },
          { contactPerson: { contains: search, mode: 'insensitive' as const } },
          { accountGroup: { contains: search, mode: 'insensitive' as const } },
          { partyCategory: { contains: search, mode: 'insensitive' as const } },
          { bankName: { contains: search, mode: 'insensitive' as const } }
        ]
      })
    };

    const skip = (page - 1) * limit;

    const [customers, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        select: customerSelect,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit
      }),
      prisma.customer.count({ where })
    ]);

    const totalPages = Math.ceil(total / limit);

    const meta: PaginationMeta = {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };

    return { customers, meta };
  }

  static async getById(companyId: string, id: string) {
    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      select: {
        ...customerSelect,
        _count: { select: { invoices: true } }
      }
    });

    if (!customer) {
      throw AppError.notFound('Customer not found');
    }

    const { _count, ...rest } = customer;
    return { ...rest, invoiceCount: _count.invoices };
  }

  static async create(companyId: string, input: CreateCustomerInput) {
    await this.assertEmailIsFree(companyId, input.email);

    return prisma.customer.create({
      data: {
        companyId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        type: input.type ?? 'BUSINESS',
        gstin: input.gstin ?? null,
        address: input.address ?? null,
        factoryAddress: input.factoryAddress ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        country: input.country ?? 'India',
        postalCode: input.postalCode ?? null,
        officeNo: input.officeNo ?? null,
        contactPerson: input.contactPerson ?? null,
        accountGroup: input.accountGroup ?? null,
        openingBalance: input.openingBalance !== undefined ? input.openingBalance : 0,
        openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null,
        balanceType: input.balanceType ?? null,
        partyCategory: input.partyCategory ?? null,
        narration1: input.narration1 ?? null,
        narration2: input.narration2 ?? null,
        bankName: input.bankName ?? null,
        accountNumber: input.accountNumber ?? null,
        ifscCode: input.ifscCode ?? null,
        isActive: input.isActive ?? true
      },
      select: customerSelect
    });
  }

  static async update(companyId: string, id: string, input: UpdateCustomerInput) {
    await this.assertExists(companyId, id);
    await this.assertEmailIsFree(companyId, input.email, id);

    // Only touch keys the caller actually sent, so a partial update never wipes
    // fields it did not mention.
    const data: Prisma.CustomerUpdateInput = {};
    const assign = <K extends keyof UpdateCustomerInput>(key: K) => {
      if (key in input) {
        if (key === 'openingBalanceDate') {
          data.openingBalanceDate = input.openingBalanceDate ? new Date(input.openingBalanceDate) : null;
        } else {
          (data as any)[key] = input[key] ?? null;
        }
      }
    };

    (
      [
        'name',
        'email',
        'phone',
        'type',
        'gstin',
        'address',
        'factoryAddress',
        'city',
        'state',
        'country',
        'postalCode',
        'officeNo',
        'contactPerson',
        'accountGroup',
        'openingBalance',
        'openingBalanceDate',
        'balanceType',
        'partyCategory',
        'narration1',
        'narration2',
        'bankName',
        'accountNumber',
        'ifscCode',
        'isActive'
      ] as const
    ).forEach(assign);

    // These columns are non-nullable in the schema; drop them if cleared.
    if (data.name === null) delete (data as any).name;
    if (data.type === null) delete (data as any).type;
    if (data.country === null) delete (data as any).country;
    if (data.isActive === null) delete (data as any).isActive;

    return prisma.customer.update({
      where: { id },
      data,
      select: customerSelect
    });
  }

  static async remove(companyId: string, id: string) {
    await this.assertExists(companyId, id);

    const [invoiceCount, productCount] = await prisma.$transaction([
      prisma.invoice.count({ where: { customerId: id, companyId } }),
      prisma.product.count({ where: { customerId: id, companyId } })
    ]);

    if (invoiceCount > 0) {
      throw AppError.conflict(
        `This customer has ${invoiceCount} invoice(s) and cannot be deleted. Deactivate the customer instead to hide them from new invoices.`
      );
    }

    // Products carry a required customer, so the FK would reject this anyway -
    // catching it here turns a raw constraint error into a clear message.
    if (productCount > 0) {
      throw AppError.conflict(
        `This customer has ${productCount} product(s) linked to them. Reassign or delete those products first, or deactivate the customer instead.`
      );
    }

    await prisma.customer.delete({ where: { id } });
    return { id };
  }

  static async setStatus(companyId: string, id: string, isActive: boolean) {
    await this.assertExists(companyId, id);

    return prisma.customer.update({
      where: { id },
      data: { isActive },
      select: customerSelect
    });
  }

  /** Confirms the row exists *and* belongs to this business before any write. */
  private static async assertExists(companyId: string, id: string) {
    const existing = await prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true }
    });

    if (!existing) {
      throw AppError.notFound('Customer not found');
    }

    return existing;
  }

  /** Emails are unique per business, not globally - two businesses may share one. */
  private static async assertEmailIsFree(companyId: string, email?: string, excludeId?: string) {
    if (!email) return;

    const duplicate = await prisma.customer.findFirst({
      where: {
        companyId,
        email: { equals: email, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } })
      },
      select: { id: true }
    });

    if (duplicate) {
      throw AppError.conflict('A customer with this email already exists in your business');
    }
  }
}
