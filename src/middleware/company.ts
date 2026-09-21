import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';
import { prisma } from '../config/database.js';

/**
 * Resolves the business (company) owned by the authenticated user and attaches
 * its id to the request. Every business-scoped resource must run this after
 * `authenticate` so queries can be filtered by companyId, which is what keeps
 * one business from ever reading another's data.
 */
export const resolveCompany = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.userId) {
      throw AppError.unauthorized('Authentication is required');
    }

    let company = await prisma.company.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (!company) {
      // Find the user to get their business/personal name
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, firstName: true, lastName: true, email: true }
      });

      if (!user) {
        throw AppError.unauthorized('User account not found');
      }

      const businessName =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        user.email.split('@')[0] ||
        'My Business';

      company = await prisma.company.create({
        data: {
          userId: user.id,
          name: businessName,
          invoicePrefix: 'INV-',
          nextInvoiceNumber: 1001,
          country: 'India'
        },
        select: { id: true }
      });
    }

    req.companyId = company.id;
    next();
  } catch (error) {
    next(error);
  }
};
