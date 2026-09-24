import { Router } from 'express';
import { AuthRequest } from '../types/index.js';
import { QuotationController } from '../controllers/quotation.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { NumberingService } from '../services/numbering.js';
import { DocumentType } from '@prisma/client';
import {
  createQuotationSchema,
  updateQuotationSchema,
  listQuotationsSchema,
  quotationIdSchema,
  rejectQuotationSchema,
  cancelQuotationSchema
} from '../validations/quotation.js';

const router = Router();

// Every quotation route is authenticated and scoped to the caller's business.
router.use(authenticate, resolveCompany);

// Preview next quotation sequence number
router.get('/next-number', async (req, res, next) => {
  try {
    const preview = await NumberingService.preview((req as AuthRequest).companyId!, DocumentType.QUOTATION, new Date());
    res.json({
      message: 'Next quotation number generated',
      data: preview
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', validate(listQuotationsSchema), QuotationController.list);
router.post('/', validate(createQuotationSchema), QuotationController.create);

router.get('/:id', validate(quotationIdSchema), QuotationController.getById);
router.patch('/:id', validate(updateQuotationSchema), QuotationController.update);
router.delete('/:id', validate(quotationIdSchema), QuotationController.delete);

router.post('/:id/send', validate(quotationIdSchema), QuotationController.send);
router.post('/:id/accept', validate(quotationIdSchema), QuotationController.accept);
router.post('/:id/reject', validate(rejectQuotationSchema), QuotationController.reject);
router.post('/:id/cancel', validate(cancelQuotationSchema), QuotationController.cancel);

router.post('/:id/duplicate', validate(quotationIdSchema), QuotationController.duplicate);
router.post('/:id/convert-to-invoice', validate(quotationIdSchema), QuotationController.convertToInvoice);

router.get('/:id/pdf', validate(quotationIdSchema), QuotationController.renderPdf);

export const quotationRoutes = router;
export default router;
