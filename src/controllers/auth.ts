import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';

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
}
