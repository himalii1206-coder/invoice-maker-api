import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NotificationService } from '../services/notification.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendResponse } from '../utils/response.js';
import { AuthRequest } from '../types/index.js';
import { AppError } from '../utils/error.js';

const router = Router();

// Notifications belong to a person, not a business, so these are scoped by the
// authenticated user rather than by company.
router.use(authenticate);

const listSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    unreadOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true')
  })
});

const idSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid notification id') })
});

const userIdOf = (req: AuthRequest): string => {
  if (!req.user?.userId) {
    throw AppError.unauthorized('Authentication is required');
  }
  return req.user.userId;
};

router.get(
  '/',
  validate(listSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page, limit, unreadOnly } = req.validated?.query ?? {};
      const result = await NotificationService.list(userIdOf(req), { page, limit, unreadOnly });

      sendResponse(
        res,
        200,
        'Notifications retrieved',
        { notifications: result.data, unreadCount: result.unreadCount },
        result.meta
      );
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id/read',
  validate(idSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await NotificationService.markRead(userIdOf(req), req.params.id as string);
      sendResponse(res, 200, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }
);

router.patch('/read-all', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await NotificationService.markAllRead(userIdOf(req));
    sendResponse(res, 200, `${count} notification(s) marked as read`, { count });
  } catch (error) {
    next(error);
  }
});

router.delete('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await NotificationService.clear(userIdOf(req));
    sendResponse(res, 200, `${count} notification(s) cleared`, { count });
  } catch (error) {
    next(error);
  }
});

export default router;
