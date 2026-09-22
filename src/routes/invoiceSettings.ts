import { Router, Response, NextFunction } from 'express';
import { InvoiceSettingsService } from '../services/invoiceSettings.js';
import { NumberingService } from '../services/numbering.js';
import { InvoiceEmailService } from '../services/invoiceEmail.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { requirePermission } from '../middleware/permissions.js';
import { updateInvoiceSettingsSchema } from '../validations/invoiceSettings.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';
import { INDIAN_STATES, GST_RATES, UNITS } from '../constants/gst.js';
import { financialYearOptions } from '../utils/date.js';
import { DocumentType } from '@prisma/client';

const router = Router();

router.use(authenticate, resolveCompany);

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await InvoiceSettingsService.get(companyIdOf(req));
    sendResponse(res, 200, 'Invoice settings retrieved successfully', settings);
  } catch (error) {
    next(error);
  }
});

router.put(
  '/',
  requirePermission('settings:write'),
  validate(updateInvoiceSettingsSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const companyId = companyIdOf(req);
      const settings = await InvoiceSettingsService.update(companyId, req.body);

      // Show the caller what the next number looks like under the new rules,
      // so a numbering change can be confirmed without saving an invoice.
      const preview = await NumberingService.preview(companyId, DocumentType.INVOICE);

      sendResponse(res, 200, 'Invoice settings updated successfully', {
        ...settings,
        nextNumberPreview: preview.number
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Reference data the invoice forms need: states for place of supply, the GST
 * rates worth offering, units, and the financial years to filter by. Served
 * from one endpoint so the client makes a single call at startup.
 */
router.get('/reference-data', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    sendResponse(res, 200, 'Reference data retrieved successfully', {
      states: INDIAN_STATES,
      gstRates: GST_RATES,
      units: UNITS,
      financialYears: financialYearOptions(6),
      email: InvoiceEmailService.status()
    });
  } catch (error) {
    next(error);
  }
});

export default router;
