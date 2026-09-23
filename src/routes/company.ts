import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { requirePermission } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { updateCompanySchema } from '../validations/company.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';
import { encryptField, decryptObject } from '../utils/encryption.js';

const router = Router();

router.use(authenticate, resolveCompany);

const companySelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  gstin: true,
  pan: true,
  logoUrl: true,
  bankName: true,
  accountNumber: true,
  ifscCode: true,
  branch: true,
  accountHolder: true,
  upiId: true,
  paymentInstructions: true,
  acceptedPaymentMethods: true,
  createdAt: true,
  updatedAt: true
} as const;

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyIdOf(req) },
      select: {
        ...companySelect,
        user: {
          select: { email: true }
        }
      }
    });

    if (!company) {
      throw AppError.notFound('Business profile not found');
    }

    const { user, ...companyData } = company;
    const effectiveEmail = companyData.email || user?.email || null;
    const decryptedCompany = decryptObject({ ...companyData, email: effectiveEmail }, ['gstin', 'pan', 'accountNumber', 'upiId']);

    sendResponse(res, 200, 'Company profile retrieved successfully', decryptedCompany);
  } catch (error) {
    next(error);
  }
});

router.put(
  '/',
  requirePermission('company:write'),
  validate(updateCompanySchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const companyId = companyIdOf(req);
      const {
        name,
        email,
        phone,
        address,
        city,
        state,
        country,
        postalCode,
        gstin,
        pan,
        bankName,
        accountNumber,
        ifscCode,
        branch,
        accountHolder,
        upiId,
        paymentInstructions,
        acceptedPaymentMethods
      } = req.body;

      const dataToUpdate: any = {};
      if (name !== undefined) dataToUpdate.name = name ? name.trim() : undefined;
      if (email !== undefined) dataToUpdate.email = email ? email.trim() : null;
      if (phone !== undefined) dataToUpdate.phone = phone ? phone.trim() : null;
      if (address !== undefined) dataToUpdate.address = address ? address.trim() : null;
      if (city !== undefined) dataToUpdate.city = city ? city.trim() : null;
      if (state !== undefined) dataToUpdate.state = state ? state.trim() : null;
      if (country !== undefined) dataToUpdate.country = country ? country.trim() : 'India';
      if (postalCode !== undefined) dataToUpdate.postalCode = postalCode ? postalCode.trim() : null;
      if (gstin !== undefined) dataToUpdate.gstin = gstin ? encryptField(gstin.trim().toUpperCase()) : null;
      if (pan !== undefined) dataToUpdate.pan = pan ? encryptField(pan.trim().toUpperCase()) : null;
      if (bankName !== undefined) dataToUpdate.bankName = bankName ? bankName.trim() : null;
      if (accountNumber !== undefined)
        dataToUpdate.accountNumber = accountNumber ? encryptField(accountNumber.trim()) : null;
      if (ifscCode !== undefined) dataToUpdate.ifscCode = ifscCode ? ifscCode.trim().toUpperCase() : null;
      if (branch !== undefined) dataToUpdate.branch = branch ? branch.trim() : null;
      if (accountHolder !== undefined) dataToUpdate.accountHolder = accountHolder ? accountHolder.trim() : null;
      if (upiId !== undefined) dataToUpdate.upiId = upiId ? encryptField(upiId.trim()) : null;
      if (paymentInstructions !== undefined)
        dataToUpdate.paymentInstructions = paymentInstructions ? paymentInstructions.trim() : null;
      if (acceptedPaymentMethods !== undefined) dataToUpdate.acceptedPaymentMethods = acceptedPaymentMethods;

      const updated = await prisma.company.update({
        where: { id: companyId },
        data: dataToUpdate,
        select: companySelect
      });

      const decryptedUpdated = decryptObject(updated, ['gstin', 'pan', 'accountNumber', 'upiId']);

      sendResponse(res, 200, 'Company profile updated successfully', decryptedUpdated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
