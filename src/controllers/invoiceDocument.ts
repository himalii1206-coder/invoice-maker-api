import { Response, NextFunction } from 'express';
import { ActivityType } from '@prisma/client';
import { PdfService } from '../services/pdf.js';
import { InvoiceEmailService } from '../services/invoiceEmail.js';
import { ActivityService } from '../services/activity.js';
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

export class InvoiceDocumentController {
  /**
   * Streams the invoice PDF.
   *
   * `?disposition=inline` renders it in the browser's viewer, which is what the
   * print action uses; the default forces a download.
   */
  static async pdf(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const companyId = companyIdOf(req);
      const invoiceId = req.params.id as string;
      const inline = (req.query.disposition as string) === 'inline';

      const { buffer, fileName } = await PdfService.renderInvoice(companyId, invoiceId);

      if (!inline) {
        await ActivityService.log({
          companyId,
          invoiceId,
          userId: req.user?.userId,
          action: ActivityType.PDF_DOWNLOADED,
          description: 'Invoice PDF downloaded',
          ipAddress: req.ip ?? null
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`
      );
      // The document changes as payments land, so it must never be cached.
      res.setHeader('Cache-Control', 'no-store');

      res.end(buffer);
    } catch (error) {
      next(error);
    }
  }

  static async email(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await InvoiceEmailService.sendInvoice(
        companyIdOf(req),
        req.params.id as string,
        req.body,
        contextOf(req)
      );

      sendResponse(res, 200, `Invoice emailed to ${result.recipient}`, result);
    } catch (error) {
      next(error);
    }
  }

  static async remind(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await InvoiceEmailService.sendReminder(
        companyIdOf(req),
        req.params.id as string,
        req.body,
        contextOf(req)
      );

      sendResponse(res, 200, `Payment reminder sent to ${result.recipient}`, result);
    } catch (error) {
      next(error);
    }
  }

  /** Lets the UI hide email actions when the server has no SMTP credentials. */
  static async emailStatus(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      sendResponse(res, 200, 'Email status retrieved successfully', InvoiceEmailService.status());
    } catch (error) {
      next(error);
    }
  }
}
