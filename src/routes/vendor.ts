import { Router } from 'express';
import { VendorController } from '../controllers/vendor.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import {
  createVendorSchema,
  updateVendorSchema,
  listVendorsSchema,
  vendorIdSchema
} from '../validations/vendor.js';

const router = Router();

router.use(authenticate, resolveCompany);

router.get('/', validate(listVendorsSchema), VendorController.list);
router.post('/', validate(createVendorSchema), VendorController.create);
router.get('/:id', validate(vendorIdSchema), VendorController.getOne);
router.put('/:id', validate(updateVendorSchema), VendorController.update);
router.delete('/:id', validate(vendorIdSchema), VendorController.remove);

export default router;
