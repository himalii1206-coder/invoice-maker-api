import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { TeamService } from '../services/team.js';
import { AuthService } from '../services/auth.js';
import { authenticate } from '../middleware/auth.js';
import { resolveCompany } from '../middleware/company.js';
import { requirePermission, PERMISSIONS } from '../middleware/permissions.js';
import { validate } from '../middleware/validate.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const router = Router();

const assignableRole = z.enum([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.STAFF], {
  errorMap: () => ({ message: 'Choose one of Admin, Accountant or Staff' })
});

const inviteSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    role: assignableRole
  })
});

const memberIdSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid team member id') })
});

const updateRoleSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid team member id') }),
  body: z.object({ role: assignableRole })
});

const acceptInviteSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'The invitation link is missing its token'),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .max(100, 'Password is too long')
      .optional()
  })
});

const companyIdOf = (req: AuthRequest): string => {
  if (!req.companyId) {
    throw AppError.notFound('No business profile found for this account');
  }
  return req.companyId;
};

// ---------------------------------------------------------------------------
// Public: following an invitation link
// ---------------------------------------------------------------------------

/**
 * Both of these are unauthenticated on purpose - the invitee may not have an
 * account yet, and the token in the link is what authorises the call.
 */
router.get('/invites/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await TeamService.describeInvite(req.params.token as string);
    sendResponse(res, 200, 'Invitation retrieved', invite);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/invites/accept',
  validate(acceptInviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user, companyId } = await TeamService.acceptInvite(req.body);

      // Accepting logs the user straight in; that is the point of the link.
      const session = await AuthService.issueSessionFor(user, companyId, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      sendResponse(res, 200, 'Invitation accepted', session);
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Authenticated: managing the team
// ---------------------------------------------------------------------------

router.use(authenticate, resolveCompany);

router.get(
  '/',
  requirePermission('team:read'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const members = await TeamService.list(companyIdOf(req));
      sendResponse(res, 200, 'Team members retrieved', {
        members,
        assignableRoles: TeamService.assignableRoles(req.companyRole),
        permissionMatrix: PERMISSIONS
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/invites',
  requirePermission('team:write'),
  validate(inviteSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await TeamService.invite({
        companyId: companyIdOf(req),
        invitedById: req.user!.userId,
        email: req.body.email,
        role: req.body.role
      });

      sendResponse(
        res,
        201,
        result.emailSent
          ? `Invitation sent to ${result.member.email}`
          : 'Invitation created. Email is not configured, so share the link yourself.',
        result
      );
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id/role',
  requirePermission('team:write'),
  validate(updateRoleSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const member = await TeamService.updateRole({
        companyId: companyIdOf(req),
        memberId: req.params.id as string,
        role: req.body.role
      });
      sendResponse(res, 200, 'Role updated successfully', member);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id',
  requirePermission('team:write'),
  validate(memberIdSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await TeamService.remove(companyIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Team member removed successfully');
    } catch (error) {
      next(error);
    }
  }
);

export default router;
