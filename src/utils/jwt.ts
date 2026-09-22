import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { JwtPayload } from '../types/index.js';
import crypto from 'crypto';

export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as any
  });
};

export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any
  });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.refreshSecret) as JwtPayload;
};

/**
 * Short-lived token issued between a correct password and a correct 2FA code.
 *
 * It is deliberately not an access token: it carries a `purpose` claim that
 * `verifyTwoFactorChallenge` insists on, so it cannot be replayed against any
 * authenticated route even though it is signed with the same secret.
 */
export const generateTwoFactorChallenge = (userId: string): string =>
  jwt.sign({ userId, purpose: 'two-factor' }, config.jwt.accessSecret, { expiresIn: '5m' });

export const verifyTwoFactorChallenge = (token: string): { userId: string } => {
  const payload = jwt.verify(token, config.jwt.accessSecret) as {
    userId?: string;
    purpose?: string;
  };

  if (payload.purpose !== 'two-factor' || !payload.userId) {
    throw new Error('Not a two-factor challenge token');
  }

  return { userId: payload.userId };
};

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
