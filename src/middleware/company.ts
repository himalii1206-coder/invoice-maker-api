import { Response, NextFunction } from 'express';
import { MemberStatus, UserRole } from '@prisma/client';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';
import { prisma } from '../config/database.js';

/**
 * Resolves the business the authenticated user is acting on and attaches its
 * id - and the caller's role within it - to the request. Every business-scoped
 * resource must run this after `authenticate` so queries can be filtered by
 * companyId, which is what keeps one business from ever reading another's data.
 *
 * A user reaches a business one of two ways: they own it, or they hold an
 * active membership after accepting an invitation. Owners are checked first,
 * so the business someone created always wins over one they were invited to.
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

    const owned = await prisma.company.findUnique({
      where: { userId: req.user.userId },
      select: { id: true }
    });

    if (owned) {
      req.companyId = owned.id;
      req.companyRole = UserRole.OWNER;
      next();
      return;
    }

    const membership = await prisma.companyMember.findFirst({
      where: { userId: req.user.userId, status: MemberStatus.ACTIVE },
      select: { companyId: true, role: true },
      orderBy: { acceptedAt: 'asc' }
    });

    if (membership) {
      req.companyId = membership.companyId;
      req.companyRole = membership.role;
      next();
      return;
    }

    // Neither an owner nor a member yet: this is someone's first request after
    // signing up, so give them their own business rather than an error.
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

    const company = await prisma.company.create({
      data: {
        userId: user.id,
        name: businessName,
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 1001,
        country: 'India'
      },
      select: { id: true }
    });

    req.companyId = company.id;
    req.companyRole = UserRole.OWNER;
    next();
  } catch (error) {
    next(error);
  }
};
