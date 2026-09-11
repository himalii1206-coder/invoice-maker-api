import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/index.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/error.js';
import { prisma } from '../config/database.js';

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Authentication token is missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw AppError.unauthorized('Authentication token is invalid');
    }

    const payload = verifyAccessToken(token);
    
    // Verify user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized('User account is inactive or no longer exists');
    }

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: payload.sessionId
    };
    req.token = token;

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      next(AppError.unauthorized('Token expired or invalid'));
    } else {
      next(error);
    }
  }
};
