import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';

export interface CreateProductInput {
  customerId: string;
  name: string;
  description?: string;
  sku?: string;
  price: number;
  unit?: string;
  taxRate?: number;
  hsnSacCode?: string;
  isActive?: boolean;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface ListProductsQuery {
  page: number;
  limit: number;
  search?: string;
  customerId?: string;
  isActive?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sortBy: 'name' | 'price' | 'taxRate' | 'sku' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

/** Shape returned to clients - keeps responses consistent across endpoints. */
const productSelect = {
  id: true,
  name: true,
  description: true,
  sku: true,
  price: true,
  unit: true,
  taxRate: true,
  hsnSacCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  customer: {
    select: { id: true, name: true, type: true, isActive: true }
  }
} satisfies Prisma.ProductSelect;

export class ProductService {
  /**
   * Every method takes companyId first and folds it into the `where` clause, so
   * a product belonging to another business is invisible rather than forbidden.
   */
  static async list(companyId: string, query: ListProductsQuery) {
    const {
      page,
      limit,
      search,
      customerId,
      isActive,
      minPrice,
      maxPrice,
      sortBy,
      sortOrder
    } = query;

    const where: Prisma.ProductWhereInput = {
      companyId,
      ...(customerId && { customerId }),
      ...(isActive !== undefined && { isActive }),
      ...((minPrice !== undefined || maxPrice !== undefined) && {
        price: {
          ...(minPrice !== undefined && { gte: minPrice }),
          ...(maxPrice !== undefined && { lte: maxPrice })
        }
      }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { sku: { contains: search, mode: 'insensitive' as const } },
          { hsnSacCode: { contains: search, mode: 'insensitive' as const } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } }
        ]
      })
    };

    const skip = (page - 1) * limit;

    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit
      }),
      prisma.product.count({ where })
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

    return { products, meta };
  }

  static async getById(companyId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: { id, companyId },
      select: productSelect
    });

    if (!product) {
      throw AppError.notFound('Product not found');
    }

    return product;
  }

  static async create(companyId: string, input: CreateProductInput) {
    await this.assertCustomerBelongsToCompany(companyId, input.customerId);
    await this.assertSkuIsFree(companyId, input.sku);

    return prisma.product.create({
      data: {
        companyId,
        customerId: input.customerId,
        name: input.name,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price: input.price,
        unit: input.unit ?? 'PCS',
        taxRate: input.taxRate ?? 18,
        hsnSacCode: input.hsnSacCode ?? null,
        isActive: input.isActive ?? true
      },
      select: productSelect
    });
  }

  static async update(companyId: string, id: string, input: UpdateProductInput) {
    await this.assertExists(companyId, id);

    if (input.customerId) {
      await this.assertCustomerBelongsToCompany(companyId, input.customerId);
    }
    await this.assertSkuIsFree(companyId, input.sku, id);

    // Only touch keys the caller actually sent, so a partial update never wipes
    // fields it did not mention.
    const data: Prisma.ProductUpdateInput = {};
    const assign = <K extends keyof UpdateProductInput>(key: K) => {
      if (key in input) {
        (data as any)[key] = input[key] ?? null;
      }
    };

    (
      [
        'name',
        'description',
        'sku',
        'price',
        'unit',
        'taxRate',
        'hsnSacCode',
        'isActive'
      ] as const
    ).forEach(assign);

    // These columns are non-nullable in the schema; drop them if cleared.
    if (data.name === null) delete (data as any).name;
    if (data.price === null) delete (data as any).price;
    if (data.unit === null) delete (data as any).unit;
    if (data.taxRate === null) delete (data as any).taxRate;
    if (data.isActive === null) delete (data as any).isActive;

    if (input.customerId) {
      data.customer = { connect: { id: input.customerId } };
    }

    return prisma.product.update({
      where: { id },
      data,
      select: productSelect
    });
  }

  static async remove(companyId: string, id: string) {
    await this.assertExists(companyId, id);

    // Invoice lines keep a nullable productId, so deleting is safe for history;
    // the line item retains its own name/price snapshot.
    await prisma.product.delete({ where: { id } });
    return { id };
  }

  static async setStatus(companyId: string, id: string, isActive: boolean) {
    await this.assertExists(companyId, id);

    return prisma.product.update({
      where: { id },
      data: { isActive },
      select: productSelect
    });
  }

  /** Confirms the row exists *and* belongs to this business before any write. */
  private static async assertExists(companyId: string, id: string) {
    const existing = await prisma.product.findFirst({
      where: { id, companyId },
      select: { id: true }
    });

    if (!existing) {
      throw AppError.notFound('Product not found');
    }

    return existing;
  }

  /** Stops a product being attached to another business's customer. */
  private static async assertCustomerBelongsToCompany(companyId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true }
    });

    if (!customer) {
      throw AppError.badRequest('Selected customer was not found in your business');
    }

    return customer;
  }

  /** SKUs are unique per business when provided, not globally. */
  private static async assertSkuIsFree(companyId: string, sku?: string, excludeId?: string) {
    if (!sku) return;

    const duplicate = await prisma.product.findFirst({
      where: {
        companyId,
        sku: { equals: sku, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } })
      },
      select: { id: true }
    });

    if (duplicate) {
      throw AppError.conflict('A product with this SKU already exists in your business');
    }
  }
}
