import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AppError } from '../utils/error.js';
import { config } from '../config/index.js';
import {
  generateTotpSecret,
  verifyTotp,
  buildOtpAuthUrl,
  generateRecoveryCodes,
  hashRecoveryCode
} from '../utils/totp.js';

/**
 * Account security: password changes, device sessions and two-factor auth.
 *
 * Kept apart from `AuthService`, which owns the login/refresh flow, so the
 * session-issuing logic stays in one place and this module only ever reads or
 * revokes what that one creates.
 */

export interface SessionView {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  device: string;
  isCurrent: boolean;
  lastUsedAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * User agents are long and unreadable in a device list, so they are reduced to
 * a "Browser on OS" label. Best-effort by design - an unrecognised agent shows
 * as "Unknown device" rather than raw text the user cannot interpret.
 */
const describeDevice = (userAgent: string | null): string => {
  if (!userAgent) return 'Unknown device';

  const browser =
    /Edg\//.test(userAgent) ? 'Edge' :
    /OPR\/|Opera/.test(userAgent) ? 'Opera' :
    /Chrome\//.test(userAgent) ? 'Chrome' :
    /Safari\//.test(userAgent) ? 'Safari' :
    /Firefox\//.test(userAgent) ? 'Firefox' :
    null;

  const os =
    /Windows NT 10/.test(userAgent) ? 'Windows' :
    /Windows/.test(userAgent) ? 'Windows' :
    /Android/.test(userAgent) ? 'Android' :
    /iPhone|iPad|iOS/.test(userAgent) ? 'iOS' :
    /Mac OS X/.test(userAgent) ? 'macOS' :
    /Linux/.test(userAgent) ? 'Linux' :
    null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
};

export class AccountSecurityService {
  // -------------------------------------------------------------------------
  // Password
  // -------------------------------------------------------------------------

  /**
   * Changes the password after proving the current one.
   *
   * Every other session is revoked on success: if the reason for the change is
   * that someone else had the old password, leaving their session alive would
   * defeat the point. The caller's own session is kept so they are not logged
   * out of the screen they just used.
   */
  static async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    currentSessionId?: string;
  }): Promise<{ revokedSessions: number }> {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, passwordHash: true }
    });

    if (!user) throw AppError.notFound('User not found');

    const isValid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!isValid) {
      throw AppError.unauthorized('Your current password is incorrect');
    }

    if (await verifyPassword(input.newPassword, user.passwordHash)) {
      throw AppError.badRequest('The new password must be different from the current one');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date()
      }
    });

    const revoked = await prisma.session.updateMany({
      where: {
        userId: user.id,
        isRevoked: false,
        ...(input.currentSessionId ? { id: { not: input.currentSessionId } } : {})
      },
      data: { isRevoked: true }
    });

    return { revokedSessions: revoked.count };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  static async listSessions(userId: string, currentSessionId?: string): Promise<SessionView[]> {
    const sessions = await prisma.session.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true
      }
    });

    return sessions.map((session) => ({
      ...session,
      device: describeDevice(session.userAgent),
      isCurrent: session.id === currentSessionId
    }));
  }

  static async revokeSession(userId: string, sessionId: string): Promise<void> {
    // Scoped by userId so a session id alone cannot log somebody else out.
    const result = await prisma.session.updateMany({
      where: { id: sessionId, userId, isRevoked: false },
      data: { isRevoked: true }
    });

    if (result.count === 0) {
      throw AppError.notFound('That session is already signed out');
    }
  }

  static async revokeOtherSessions(
    userId: string,
    currentSessionId?: string
  ): Promise<{ revokedSessions: number }> {
    const result = await prisma.session.updateMany({
      where: {
        userId,
        isRevoked: false,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {})
      },
      data: { isRevoked: true }
    });

    return { revokedSessions: result.count };
  }

  /**
   * Stamps a session as used. Called on refresh rather than on every request:
   * a write per API call would be a lot of traffic for a timestamp whose only
   * job is to order the device list.
   */
  static async touchSession(sessionId: string): Promise<void> {
    try {
      await prisma.session.updateMany({
        where: { id: sessionId },
        data: { lastUsedAt: new Date() }
      });
    } catch (error) {
      console.error('Could not update session activity:', error);
    }
  }

  // -------------------------------------------------------------------------
  // Two-factor authentication
  // -------------------------------------------------------------------------

  static async twoFactorStatus(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: true,
        twoFactorRecoveryCodes: true
      }
    });

    if (!user) throw AppError.notFound('User not found');

    return {
      enabled: user.twoFactorEnabled,
      confirmedAt: user.twoFactorConfirmedAt,
      recoveryCodesRemaining: user.twoFactorRecoveryCodes.length
    };
  }

  /**
   * Starts enrolment: generates a secret and returns the otpauth URI to show as
   * a QR code. The secret is parked in `twoFactorPendingSecret` and does not
   * protect the account until a valid code proves the user can generate one -
   * otherwise a mis-scanned QR would lock them out.
   */
  static async beginTwoFactorSetup(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true }
    });

    if (!user) throw AppError.notFound('User not found');

    if (user.twoFactorEnabled) {
      throw AppError.conflict('Two-factor authentication is already enabled');
    }

    const secret = generateTotpSecret();

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorPendingSecret: secret }
    });

    return {
      secret,
      otpauthUrl: buildOtpAuthUrl({
        secret,
        accountName: user.email,
        issuer: config.twoFactorIssuer
      })
    };
  }

  /** Confirms enrolment with a code from the app and issues recovery codes. */
  static async enableTwoFactor(userId: string, token: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorPendingSecret: true, twoFactorEnabled: true }
    });

    if (!user) throw AppError.notFound('User not found');

    if (user.twoFactorEnabled) {
      throw AppError.conflict('Two-factor authentication is already enabled');
    }

    if (!user.twoFactorPendingSecret) {
      throw AppError.badRequest('Start the setup again - no pending authenticator was found');
    }

    if (!verifyTotp(user.twoFactorPendingSecret, token)) {
      throw AppError.badRequest('That code is not valid. Check your authenticator app and try again.');
    }

    const recoveryCodes = generateRecoveryCodes();

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
        twoFactorConfirmedAt: new Date(),
        twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode)
      }
    });

    // The only time the plaintext codes exist. They are never recoverable later.
    return { recoveryCodes };
  }

  /** Disabling is a security-lowering change, so it re-checks the password. */
  static async disableTwoFactor(userId: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, twoFactorEnabled: true }
    });

    if (!user) throw AppError.notFound('User not found');

    if (!user.twoFactorEnabled) {
      throw AppError.badRequest('Two-factor authentication is not enabled');
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      throw AppError.unauthorized('Your password is incorrect');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorConfirmedAt: null,
        twoFactorRecoveryCodes: []
      }
    });
  }

  static async regenerateRecoveryCodes(userId: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, twoFactorEnabled: true }
    });

    if (!user) throw AppError.notFound('User not found');

    if (!user.twoFactorEnabled) {
      throw AppError.badRequest('Two-factor authentication is not enabled');
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      throw AppError.unauthorized('Your password is incorrect');
    }

    const recoveryCodes = generateRecoveryCodes();

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode) }
    });

    return { recoveryCodes };
  }

  /**
   * Checks a login challenge against the authenticator, then against the
   * recovery codes. A used recovery code is consumed so it cannot be replayed.
   */
  static async verifyLoginChallenge(userId: string, code: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorRecoveryCodes: true }
    });

    if (!user?.twoFactorSecret) return false;

    if (verifyTotp(user.twoFactorSecret, code)) return true;

    const candidate = hashRecoveryCode(code);
    const match = user.twoFactorRecoveryCodes.find((stored) =>
      stored.length === candidate.length &&
      crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(candidate))
    );

    if (!match) return false;

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((stored) => stored !== match)
      }
    });

    return true;
  }
}
