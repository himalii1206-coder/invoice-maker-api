import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId?: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  token?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}
