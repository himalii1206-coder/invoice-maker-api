import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReportService, ReportScope } from '../services/reports.js';
import { PaymentService } from '../services/payment.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const router = Router();

router.use(authenticate, resolveCompany);

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

/** Every report accepts the same window, so one schema covers them all. */
const reportScopeSchema = z.object({
  query: z.object({
    financialYear: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, 'Financial year must look like 2026-27')
      .optional(),
    year: z.coerce.number().int().min(1970).max(2200).optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    customerId: z.string().uuid('Invalid customer id').optional(),
    includeDrafts: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
});

type ScopeQuery = ReportScope & { limit: number };

const scopeOf = (req: AuthRequest): ScopeQuery => req.validated?.query as ScopeQuery;

router.get(
  '/monthly-sales',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await ReportService.monthlySales(companyIdOf(req), scopeOf(req));
      sendResponse(res, 200, 'Monthly sales report generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/yearly-sales',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await ReportService.yearlySales(companyIdOf(req), scopeOf(req));
      sendResponse(res, 200, 'Yearly sales report generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/customer-sales',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const scope = scopeOf(req);
      const data = await ReportService.customerSales(companyIdOf(req), scope, scope.limit);
      sendResponse(res, 200, 'Customer sales report generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/product-sales',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const scope = scopeOf(req);
      const data = await ReportService.productSales(companyIdOf(req), scope, scope.limit);
      sendResponse(res, 200, 'Product sales report generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/gst-summary',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await ReportService.gstSummary(companyIdOf(req), scopeOf(req));
      sendResponse(res, 200, 'GST summary generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/aging',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await ReportService.agingReport(companyIdOf(req), scopeOf(req));
      sendResponse(res, 200, 'Receivables aging report generated', data);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/payments',
  validate(reportScopeSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const scope = scopeOf(req);
      const data = await PaymentService.summary(companyIdOf(req), {
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo
      });
      sendResponse(res, 200, 'Payments summary generated', data);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
