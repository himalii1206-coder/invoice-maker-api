import { Router } from 'express';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import customerRoutes from './customer.js';
import productRoutes from './product.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/products', productRoutes);

export default router;
