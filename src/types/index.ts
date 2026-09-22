import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId?: string;
}

export interface ValidatedData {
  body?: any;
  query?: any;
  params?: any;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  token?: string;
  companyId?: string;
  /**
   * The caller's role *within the resolved business*. An owner carries their
   * user role; an invited collaborator carries the role on their membership,
   * which may differ from `user.role`.
   */
  companyRole?: string;
  /**
   * Output of the `validate` middleware. Zod coercion and defaults (e.g. the
   * numeric `page`/`limit`) only exist here - `req.query` keeps the raw strings.
   */
  validated?: ValidatedData;
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
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
