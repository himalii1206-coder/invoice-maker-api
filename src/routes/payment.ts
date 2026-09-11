import { Router } from 'express';
import { PaymentController } from '../controllers/payment.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import {
  listPaymentsSchema,
  updatePaymentSchema,
  paymentIdSchema
} from '../validations/payment.js';

const router = Router();

router.use(authenticate, resolveCompany);

// Payments nested under an invoice live on the invoice router; these are the
// business-wide views and the by-id operations.
router.get('/', validate(listPaymentsSchema), PaymentController.list);
router.put('/:paymentId', validate(updatePaymentSchema), PaymentController.update);
router.delete('/:paymentId', validate(paymentIdSchema), PaymentController.remove);

export default router;
