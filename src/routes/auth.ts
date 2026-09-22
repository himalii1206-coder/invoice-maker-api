import { Router } from 'express';
import { AuthController } from '../controllers/auth.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  verifyTwoFactorSchema,
  changePasswordSchema,
  enableTwoFactorSchema,
  passwordConfirmationSchema,
  sessionIdSchema
} from '../validations/auth.js';

const router = Router();

router.post('/register', validate(registerSchema), AuthController.register);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/login/2fa', validate(verifyTwoFactorSchema), AuthController.verifyTwoFactor);
router.post('/refresh', validate(refreshTokenSchema), AuthController.refresh);
router.post('/logout', authenticate, AuthController.logout);
router.get('/me', authenticate, AuthController.me);

// Account security. These act on the caller's own account, so they need
// `authenticate` but deliberately not `resolveCompany` - a password change is
// not a business-scoped operation.
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  AuthController.changePassword
);

router.get('/sessions', authenticate, AuthController.listSessions);
router.delete('/sessions/others', authenticate, AuthController.revokeOtherSessions);
router.delete(
  '/sessions/:id',
  authenticate,
  validate(sessionIdSchema),
  AuthController.revokeSession
);

router.get('/2fa', authenticate, AuthController.twoFactorStatus);
router.post('/2fa/setup', authenticate, AuthController.beginTwoFactorSetup);
router.post(
  '/2fa/enable',
  authenticate,
  validate(enableTwoFactorSchema),
  AuthController.enableTwoFactor
);
router.post(
  '/2fa/disable',
  authenticate,
  validate(passwordConfirmationSchema),
  AuthController.disableTwoFactor
);
router.post(
  '/2fa/recovery-codes',
  authenticate,
  validate(passwordConfirmationSchema),
  AuthController.regenerateRecoveryCodes
);

export default router;
