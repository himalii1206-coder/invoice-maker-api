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

    const company = await prisma.company.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (!company) {
      throw AppError.notFound('No business profile found for this account');
    }

    req.companyId = company.id;
    next();
  } catch (error) {
    next(error);
  }
};
