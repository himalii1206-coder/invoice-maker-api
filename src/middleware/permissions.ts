import { Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

/**
 * Role-based access control.
 *
 * Roles are ranked rather than compared for equality, so a route that needs an
 * ACCOUNTANT is automatically open to an ADMIN and the OWNER. `MEMBER` is the
 * pre-existing role from before the team module and is treated as STAFF.
 */
const RANK: Record<UserRole, number> = {
  [UserRole.OWNER]: 40,
  [UserRole.ADMIN]: 30,
  [UserRole.ACCOUNTANT]: 20,
  [UserRole.STAFF]: 10,
  [UserRole.MEMBER]: 10
};

export const roleRank = (role: string | undefined): number =>
  RANK[(role ?? UserRole.STAFF) as UserRole] ?? 0;

/**
 * What each role may do. Kept as data so the same matrix can be sent to the
 * client, which uses it to hide actions the server would reject anyway.
 */
export const PERMISSIONS = {
  'invoice:read': UserRole.STAFF,
  'invoice:write': UserRole.STAFF,
  'invoice:delete': UserRole.ACCOUNTANT,
  'payment:write': UserRole.ACCOUNTANT,
  'customer:write': UserRole.STAFF,
  'product:write': UserRole.STAFF,
  'purchase:write': UserRole.ACCOUNTANT,
  'report:read': UserRole.ACCOUNTANT,
  'settings:read': UserRole.STAFF,
  'settings:write': UserRole.ADMIN,
  'company:write': UserRole.ADMIN,
  'team:read': UserRole.ADMIN,
  'team:write': UserRole.OWNER
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: string | undefined, permission: Permission): boolean =>
  roleRank(role) >= roleRank(PERMISSIONS[permission]);

/** Permission map for one role, for the client to mirror the server's rules. */
export const permissionsFor = (role: string | undefined): Record<Permission, boolean> =>
  Object.fromEntries(
    (Object.keys(PERMISSIONS) as Permission[]).map((key) => [key, can(role, key)])
  ) as Record<Permission, boolean>;

/** Route guard. Run after `authenticate` and `resolveCompany`. */
export const requirePermission =
  (permission: Permission) =>
  (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized('Authentication is required'));
      return;
    }

    if (!can(req.companyRole ?? req.user.role, permission)) {
      next(
        AppError.forbidden(
          'Your role does not allow this action. Ask a business owner or admin to make the change.'
        )
      );
      return;
    }

    next();
  };
