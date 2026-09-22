import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { validate } from '../middleware/validate.js';
import { updateCompanySchema } from '../validations/company.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const router = Router();

router.use(authenticate, resolveCompany);

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
        createdAt: true,
        updatedAt: true
      }
    });

    if (!company) {
      throw AppError.notFound('Business profile not found');
    }

    sendResponse(res, 200, 'Company profile retrieved successfully', company);
  } catch (error) {
    next(error);
  }
});

router.put(
  '/',
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
        branch
      } = req.body;

      const updated = await prisma.company.update({
        where: { id: companyId },
        data: {
          name: name.trim(),
          email: email ? email.trim() : null,
          phone: phone ? phone.trim() : null,
          address: address ? address.trim() : null,
          city: city ? city.trim() : null,
          state: state ? state.trim() : null,
          country: country ? country.trim() : 'India',
          postalCode: postalCode ? postalCode.trim() : null,
          gstin: gstin ? gstin.trim().toUpperCase() : null,
          pan: pan ? pan.trim().toUpperCase() : null,
          bankName: bankName ? bankName.trim() : null,
          accountNumber: accountNumber ? accountNumber.trim() : null,
          ifscCode: ifscCode ? ifscCode.trim().toUpperCase() : null,
          branch: branch ? branch.trim() : null
        },
        select: {
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
          createdAt: true,
          updatedAt: true
        }
      });

      sendResponse(res, 200, 'Company profile updated successfully', updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
