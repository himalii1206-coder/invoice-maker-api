import { Response, NextFunction } from 'express';
import { PaymentService, ListPaymentsQuery } from '../services/payment.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

const contextOf = (req: AuthRequest) => ({
  userId: req.user?.userId,
  ipAddress: req.ip ?? null
});

export class PaymentController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as ListPaymentsQuery;
      const { payments, meta, summary } = await PaymentService.list(companyIdOf(req), query);
      sendResponse(res, 200, 'Payments retrieved successfully', { payments, summary }, meta);
    } catch (error) {
      next(error);
    }
  }

  static async listForInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const payments = await PaymentService.listForInvoice(
        companyIdOf(req),
        req.params.id as string
      );
      sendResponse(res, 200, 'Payments retrieved successfully', payments);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await PaymentService.create(
        companyIdOf(req),
        req.params.id as string,
        req.body,
        contextOf(req)
      );
      sendResponse(res, 201, 'Payment recorded successfully', payment);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const payment = await PaymentService.update(
        companyIdOf(req),
        req.params.paymentId as string,
        req.body,
        contextOf(req)
      );
      sendResponse(res, 200, 'Payment updated successfully', payment);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await PaymentService.remove(
        companyIdOf(req),
        req.params.paymentId as string,
        contextOf(req)
      );
      sendResponse(res, 200, 'Payment deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}
