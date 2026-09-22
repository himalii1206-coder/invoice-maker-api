import { Response, NextFunction } from 'express';
import { PurchaseBillService, ListPurchaseBillsQuery } from '../services/purchaseBill.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

export class PurchaseBillController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = (req.validated?.query || req.query) as unknown as ListPurchaseBillsQuery;
      const { purchaseBills, meta } = await PurchaseBillService.list(companyIdOf(req), query);
      sendResponse(res, 200, 'Purchase bills retrieved successfully', purchaseBills, meta);
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const purchaseBill = await PurchaseBillService.findById(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Purchase bill retrieved successfully', purchaseBill);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const purchaseBill = await PurchaseBillService.create(companyIdOf(req), req.body);
      sendResponse(res, 201, 'Purchase bill created successfully', purchaseBill);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const purchaseBill = await PurchaseBillService.update(
        companyIdOf(req),
        req.params.id as string,
        req.body
      );
      sendResponse(res, 200, 'Purchase bill updated successfully', purchaseBill);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await PurchaseBillService.delete(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, result.message);
    } catch (error) {
      next(error);
    }
  }

  static async recordPayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await PurchaseBillService.recordPayment(
        companyIdOf(req),
        req.params.id as string,
        req.body
      );
      sendResponse(res, 201, 'Payment recorded successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async deletePayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const updated = await PurchaseBillService.deletePayment(
        companyIdOf(req),
        req.params.id as string,
        req.params.paymentId as string
      );
      sendResponse(res, 200, 'Payment removed successfully', updated);
    } catch (error) {
      next(error);
    }
  }

  static async getDashboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const financialYear = (req.query.financialYear as string) || undefined;
      const metrics = await PurchaseBillService.getDashboardMetrics(companyIdOf(req), financialYear);
      sendResponse(res, 200, 'Purchase metrics retrieved successfully', metrics);
    } catch (error) {
      next(error);
    }
  }
}
