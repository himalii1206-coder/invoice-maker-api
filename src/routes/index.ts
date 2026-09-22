import { Router } from 'express';
import healthRoutes from './health.js';
import authRoutes from './auth.js';
import customerRoutes from './customer.js';
import productRoutes from './product.js';
import invoiceRoutes from './invoice.js';
import paymentRoutes from './payment.js';
import invoiceSettingsRoutes from './invoiceSettings.js';
import reportRoutes from './report.js';
import companyRoutes from './company.js';
import vendorRoutes from './vendor.js';
import purchaseBillRoutes from './purchaseBill.js';
import teamRoutes from './team.js';
import notificationRoutes from './notification.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/vendors', vendorRoutes);
router.use('/products', productRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/purchase-bills', purchaseBillRoutes);
router.use('/payments', paymentRoutes);
router.use('/invoice-settings', invoiceSettingsRoutes);
router.use('/reports', reportRoutes);
router.use('/company', companyRoutes);
router.use('/team', teamRoutes);
router.use('/notifications', notificationRoutes);

export default router;

