import { Router, Request, Response } from 'express';
import { sendResponse } from '../utils/response.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  sendResponse(res, 200, 'Invoice Maker API operational', {
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

export default router;
