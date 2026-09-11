import { Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';
import { AuthRequest } from '../types/index.js';

export const validate =
  (schema: AnyZodObject) =>
  async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = (await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      })) as Record<string, any>;

      // Expose the coerced/defaulted values. `req.query` is a getter on Express 5
      // so it is never reassigned; controllers read `req.validated.query` instead.
      req.validated = {
        body: parsed.body,
        query: parsed.query,
        params: parsed.params
      };

      if (parsed.body !== undefined) {
        req.body = parsed.body;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
