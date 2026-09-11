import { Response, NextFunction } from 'express';
import { ProductService, ListProductsQuery } from '../services/product.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

/** `resolveCompany` guarantees this, but the check keeps TS and runtime honest. */
const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

export class ProductController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as ListProductsQuery;
      const { products, meta } = await ProductService.list(companyIdOf(req), query);
      sendResponse(res, 200, 'Products retrieved successfully', products, meta);
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await ProductService.getById(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Product retrieved successfully', product);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await ProductService.create(companyIdOf(req), req.body);
      sendResponse(res, 201, 'Product created successfully', product);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await ProductService.update(
        companyIdOf(req),
        req.params.id as string,
        req.body
      );
      sendResponse(res, 200, 'Product updated successfully', product);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await ProductService.remove(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Product deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const isActive = Boolean(req.body.isActive);
      const product = await ProductService.setStatus(
        companyIdOf(req),
        req.params.id as string,
        isActive
      );
      sendResponse(
        res,
        200,
        `Product ${isActive ? 'activated' : 'deactivated'} successfully`,
        product
      );
    } catch (error) {
      next(error);
    }
  }
}
