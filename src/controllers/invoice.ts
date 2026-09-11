import { Response, NextFunction } from 'express';
import { DocumentType, InvoiceStatus } from '@prisma/client';
import { InvoiceService, ListInvoicesQuery } from '../services/invoice.js';
import { ActivityService } from '../services/activity.js';
import { NumberingService } from '../services/numbering.js';
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

/** Who did it and from where - attached to every activity entry. */
const contextOf = (req: AuthRequest) => ({
  userId: req.user?.userId,
  ipAddress: req.ip ?? null
});

export class InvoiceController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as ListInvoicesQuery;
      const { invoices, meta, summary } = await InvoiceService.list(companyIdOf(req), query);

      sendResponse(res, 200, 'Invoices retrieved successfully', { invoices, summary }, meta);
    } catch (error) {
      next(error);
    }
  }

  static async dashboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as {
        financialYear?: string;
        dateFrom?: string;
        dateTo?: string;
      };

      const stats = await InvoiceService.dashboard(companyIdOf(req), query);
      sendResponse(res, 200, 'Invoice dashboard retrieved successfully', stats);
    } catch (error) {
      next(error);
    }
  }

  /** Everything the create form needs to render before the user types anything. */
  static async defaults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const defaults = await InvoiceService.newInvoiceDefaults(companyIdOf(req));
      sendResponse(res, 200, 'Invoice defaults retrieved successfully', defaults);
    } catch (error) {
      next(error);
    }
  }

  static async previewNumber(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as { documentType: DocumentType; date?: string };
      const preview = await NumberingService.preview(
        companyIdOf(req),
        query.documentType,
        query.date ? new Date(query.date) : new Date()
      );

      sendResponse(res, 200, 'Next document number generated', preview);
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const invoice = await InvoiceService.getById(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Invoice retrieved successfully', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const invoice = await InvoiceService.create(companyIdOf(req), req.body, contextOf(req));
      sendResponse(res, 201, 'Invoice created successfully', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const invoice = await InvoiceService.update(
        companyIdOf(req),
        req.params.id as string,
        req.body,
        contextOf(req)
      );
      sendResponse(res, 200, 'Invoice updated successfully', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async setStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = req.body.status as Extract<InvoiceStatus, 'DRAFT' | 'SENT'>;
      const invoice = await InvoiceService.setStatus(
        companyIdOf(req),
        req.params.id as string,
        status,
        contextOf(req)
      );

      sendResponse(
        res,
        200,
        status === InvoiceStatus.SENT ? 'Invoice marked as sent' : 'Invoice moved back to draft',
        invoice
      );
    } catch (error) {
      next(error);
    }
  }

  static async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const invoice = await InvoiceService.cancel(
        companyIdOf(req),
        req.params.id as string,
        req.body.reason,
        contextOf(req)
      );
      sendResponse(res, 200, 'Invoice cancelled successfully', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async duplicate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const invoice = await InvoiceService.duplicate(
        companyIdOf(req),
        req.params.id as string,
        contextOf(req)
      );
      sendResponse(res, 201, 'Invoice duplicated successfully', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await InvoiceService.remove(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Invoice deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async activity(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.validated?.query as { page: number; limit: number };
      const companyId = companyIdOf(req);
      const invoiceId = req.params.id as string;

      // Confirms the invoice belongs to this business before exposing its trail.
      await InvoiceService.getById(companyId, invoiceId);

      const { activities, meta } = await ActivityService.listForInvoice(
        companyId,
        invoiceId,
        query
      );

      sendResponse(res, 200, 'Invoice activity retrieved successfully', activities, meta);
    } catch (error) {
      next(error);
    }
  }
}
