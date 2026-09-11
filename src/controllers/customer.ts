import { Response, NextFunction } from 'express';
import { CustomerService, ListCustomersQuery } from '../services/customer.js';
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

export class CustomerController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as ListCustomersQuery;
      const { customers, meta } = await CustomerService.list(companyIdOf(req), query);
      sendResponse(res, 200, 'Customers retrieved successfully', customers, meta);
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const customer = await CustomerService.getById(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Customer retrieved successfully', customer);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const customer = await CustomerService.create(companyIdOf(req), req.body);
      sendResponse(res, 201, 'Customer created successfully', customer);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const customer = await CustomerService.update(
        companyIdOf(req),
        req.params.id as string,
        req.body
      );
      sendResponse(res, 200, 'Customer updated successfully', customer);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await CustomerService.remove(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Customer deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const isActive = Boolean(req.body.isActive);
      const customer = await CustomerService.setStatus(
        companyIdOf(req),
        req.params.id as string,
        isActive
      );
      sendResponse(
        res,
        200,
        `Customer ${isActive ? 'activated' : 'deactivated'} successfully`,
        customer
      );
    } catch (error) {
      next(error);
    }
  }
}
