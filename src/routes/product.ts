import { Router } from 'express';
import { ProductController } from '../controllers/product.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  productIdSchema,
  productStatusSchema
} from '../validations/product.js';

const router = Router();

// Every product route is authenticated and scoped to the caller's business.
router.use(authenticate, resolveCompany);

router.get('/', validate(listProductsSchema), ProductController.list);
router.post('/', validate(createProductSchema), ProductController.create);
router.get('/:id', validate(productIdSchema), ProductController.getOne);
router.put('/:id', validate(updateProductSchema), ProductController.update);
router.patch('/:id/status', validate(productStatusSchema), ProductController.setStatus);
router.delete('/:id', validate(productIdSchema), ProductController.remove);

export default router;
