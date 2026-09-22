import { Response, NextFunction } from 'express';
import { VendorService, ListVendorsQuery } from '../services/vendor.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

export class VendorController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = (req.validated?.query || req.query) as unknown as ListVendorsQuery;
      const { vendors, meta } = await VendorService.list(companyIdOf(req), query);
      sendResponse(res, 200, 'Vendors retrieved successfully', vendors, meta);
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const vendor = await VendorService.findById(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Vendor retrieved successfully', vendor);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const vendor = await VendorService.create(companyIdOf(req), req.body);
      sendResponse(res, 201, 'Vendor created successfully', vendor);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const vendor = await VendorService.update(
        companyIdOf(req),
        req.params.id as string,
        req.body
      );
      sendResponse(res, 200, 'Vendor updated successfully', vendor);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await VendorService.delete(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, result.message);
    } catch (error) {
      next(error);
    }
  }
}
