import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.js';
import { AccountSecurityService } from '../services/accountSecurity.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const meta = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      };
      const result = await AuthService.register(req.body, meta);
      sendResponse(res, 201, 'Account and business created successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login({
        ...req.body,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      if ('requiresTwoFactor' in result) {
        sendResponse(res, 200, 'Enter the code from your authenticator app', result);
        return;
      }

      sendResponse(res, 200, 'Logged in successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async verifyTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.completeTwoFactorLogin({
        challengeToken: req.body.challengeToken,
        code: req.body.code,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });
      sendResponse(res, 200, 'Logged in successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const meta = {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      };
      const result = await AuthService.refresh(req.body.refreshToken, meta);
      sendResponse(res, 200, 'Tokens refreshed successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.body?.refreshToken;
      await AuthService.logout(req.user?.sessionId, refreshToken);
      sendResponse(res, 200, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async me(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        return next(new Error('User ID not attached to request'));
      }
      const user = await AuthService.getCurrentUser(req.user.userId);
      sendResponse(res, 200, 'Current user profile retrieved', { user });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Account security
  // ---------------------------------------------------------------------------

  static async changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AccountSecurityService.changePassword({
        userId: userIdOf(req),
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
        currentSessionId: req.user?.sessionId
      });
      sendResponse(
        res,
        200,
        result.revokedSessions > 0
          ? `Password changed. ${result.revokedSessions} other session(s) were signed out.`
          : 'Password changed successfully',
        result
      );
    } catch (error) {
      next(error);
    }
  }

  static async listSessions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const sessions = await AccountSecurityService.listSessions(
        userIdOf(req),
        req.user?.sessionId
      );
      sendResponse(res, 200, 'Active sessions retrieved', sessions);
    } catch (error) {
      next(error);
    }
  }

  static async revokeSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await AccountSecurityService.revokeSession(userIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Session signed out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async revokeOtherSessions(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await AccountSecurityService.revokeOtherSessions(
        userIdOf(req),
        req.user?.sessionId
      );
      sendResponse(res, 200, `${result.revokedSessions} other session(s) signed out`, result);
    } catch (error) {
      next(error);
    }
  }

  static async twoFactorStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await AccountSecurityService.twoFactorStatus(userIdOf(req));
      sendResponse(res, 200, 'Two-factor status retrieved', status);
    } catch (error) {
      next(error);
    }
  }

  static async beginTwoFactorSetup(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const setup = await AccountSecurityService.beginTwoFactorSetup(userIdOf(req));
      sendResponse(res, 200, 'Scan the QR code with your authenticator app', setup);
    } catch (error) {
      next(error);
    }
  }

  static async enableTwoFactor(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AccountSecurityService.enableTwoFactor(userIdOf(req), req.body.code);
      sendResponse(res, 200, 'Two-factor authentication is now active', result);
    } catch (error) {
      next(error);
    }
  }

  static async disableTwoFactor(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await AccountSecurityService.disableTwoFactor(userIdOf(req), req.body.password);
      sendResponse(res, 200, 'Two-factor authentication disabled');
    } catch (error) {
      next(error);
    }
  }

  static async regenerateRecoveryCodes(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await AccountSecurityService.regenerateRecoveryCodes(
        userIdOf(req),
        req.body.password
      );
      sendResponse(res, 200, 'New recovery codes generated', result);
    } catch (error) {
      next(error);
    }
  }
}

const userIdOf = (req: AuthRequest): string => {
  if (!req.user?.userId) {
    throw AppError.unauthorized('Authentication is required');
  }
  return req.user.userId;
};
