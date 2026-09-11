import { Router } from 'express';
import { CustomerController } from '../controllers/customer.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
  customerIdSchema,
  customerStatusSchema
} from '../validations/customer.js';

const router = Router();

// Every customer route is authenticated and scoped to the caller's business.
router.use(authenticate, resolveCompany);

router.get('/', validate(listCustomersSchema), CustomerController.list);
router.post('/', validate(createCustomerSchema), CustomerController.create);
router.get('/:id', validate(customerIdSchema), CustomerController.getOne);
router.put('/:id', validate(updateCustomerSchema), CustomerController.update);
router.patch('/:id/status', validate(customerStatusSchema), CustomerController.setStatus);
router.delete('/:id', validate(customerIdSchema), CustomerController.remove);

export default router;
