import { Router } from 'express';
import { PurchaseBillController } from '../controllers/purchaseBill.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import {
  createPurchaseBillSchema,
  updatePurchaseBillSchema,
  listPurchaseBillsSchema,
  purchaseBillIdSchema,
  recordPurchasePaymentSchema
} from '../validations/purchaseBill.js';

const router = Router();

router.use(authenticate, resolveCompany);

router.get('/dashboard', PurchaseBillController.getDashboard);
router.get('/', validate(listPurchaseBillsSchema), PurchaseBillController.list);
router.post('/', validate(createPurchaseBillSchema), PurchaseBillController.create);
router.get('/:id', validate(purchaseBillIdSchema), PurchaseBillController.getOne);
router.put('/:id', validate(updatePurchaseBillSchema), PurchaseBillController.update);
router.delete('/:id', validate(purchaseBillIdSchema), PurchaseBillController.remove);

router.post('/:id/payments', validate(recordPurchasePaymentSchema), PurchaseBillController.recordPayment);
router.delete('/:id/payments/:paymentId', PurchaseBillController.deletePayment);

export default router;
