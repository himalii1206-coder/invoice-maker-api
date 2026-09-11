import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { PaymentController } from '../controllers/payment.js';
import { InvoiceDocumentController } from '../controllers/invoiceDocument.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  listInvoicesSchema,
  invoiceIdSchema,
  invoiceStatusSchema,
  cancelInvoiceSchema,
  invoiceDashboardSchema,
  invoiceActivitySchema,
  previewNumberSchema
} from '../validations/invoice.js';
import { createPaymentSchema, invoicePaymentsSchema } from '../validations/payment.js';
import { sendInvoiceEmailSchema } from '../validations/invoiceSettings.js';

const router = Router();

// Every invoice route is authenticated and scoped to the caller's business.
router.use(authenticate, resolveCompany);

// Collection-level reads. Declared before `/:id` so they are not swallowed by it.
router.get('/dashboard', validate(invoiceDashboardSchema), InvoiceController.dashboard);
router.get('/defaults', InvoiceController.defaults);
router.get('/email-status', InvoiceDocumentController.emailStatus);
router.get('/next-number', validate(previewNumberSchema), InvoiceController.previewNumber);

router.get('/', validate(listInvoicesSchema), InvoiceController.list);
router.post('/', validate(createInvoiceSchema), InvoiceController.create);

router.get('/:id', validate(invoiceIdSchema), InvoiceController.getOne);
router.put('/:id', validate(updateInvoiceSchema), InvoiceController.update);
router.delete('/:id', validate(invoiceIdSchema), InvoiceController.remove);

router.get('/:id/activity', validate(invoiceActivitySchema), InvoiceController.activity);
router.patch('/:id/status', validate(invoiceStatusSchema), InvoiceController.setStatus);
router.patch('/:id/cancel', validate(cancelInvoiceSchema), InvoiceController.cancel);
router.post('/:id/duplicate', validate(invoiceIdSchema), InvoiceController.duplicate);

// Document actions: print, download, email and manual reminder.
router.get('/:id/pdf', validate(invoiceIdSchema), InvoiceDocumentController.pdf);
router.post('/:id/email', validate(sendInvoiceEmailSchema), InvoiceDocumentController.email);
router.post('/:id/remind', validate(sendInvoiceEmailSchema), InvoiceDocumentController.remind);

// Payments recorded against a specific invoice.
router.get('/:id/payments', validate(invoicePaymentsSchema), PaymentController.listForInvoice);
router.post('/:id/payments', validate(createPaymentSchema), PaymentController.create);

export default router;
