import { prisma } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateTwoFactorChallenge,
  verifyTwoFactorChallenge,
  hashToken
} from '../utils/jwt.js';
import { AppError } from '../utils/error.js';
import { AccountSecurityService } from './accountSecurity.js';
import { permissionsFor } from '../middleware/permissions.js';
import { MemberStatus, UserRole } from '@prisma/client';
import { resolveState } from '../constants/gst.js';
import { encryptField, decryptObject } from '../utils/encryption.js';

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  businessName: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  branch?: string;
  upiId?: string;
  invoicePrefix?: string;
  nextInvoiceNumber?: number;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export class AuthService {
  static async register(input: RegisterInput, meta?: { userAgent?: string; ipAddress?: string }) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (existingUser) {
      throw AppError.conflict('An account with this email address already exists');
    }

    const passwordHash = await hashPassword(input.password);

    // Auto-extract PAN from GSTIN if not provided
    let pan = input.pan || null;
    let state = input.state || null;
    if (input.gstin && input.gstin.length === 15) {
      if (!pan) {
        pan = input.gstin.slice(2, 12);
      }
      if (!state) {
        const resolved = resolveState(input.gstin.slice(0, 2));
        if (resolved) state = resolved.name;
      }
    }

    // Create User & Company in a single atomic transaction with encrypted sensitive fields
    const result = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email.toLowerCase(),
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: 'OWNER'
          }
        });

        const company = await tx.company.create({
          data: {
            userId: user.id,
            name: input.businessName,
            email: input.email.toLowerCase(),
            phone: input.phone || null,
            gstin: encryptField(input.gstin) || null,
            pan: encryptField(pan) || null,
            address: input.address || null,
            city: input.city || null,
            state,
            postalCode: input.postalCode || null,
            bankName: input.bankName || null,
            accountNumber: encryptField(input.accountNumber) || null,
            ifscCode: input.ifscCode || null,
            branch: input.branch || null,
            upiId: encryptField(input.upiId) || null,
            invoicePrefix: input.invoicePrefix || 'INV-',
            nextInvoiceNumber: input.nextInvoiceNumber || 1001
          }
        });

        return { user, company };
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // Create auth session & tokens
    const tokens = await this.createSession(result.user.id, result.user.email, result.user.role, meta);

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role
      },
      company: {
        id: result.company.id,
        name: result.company.name,
        invoicePrefix: result.company.invoicePrefix
      },
      ...tokens
    };
  }

  static async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { company: true }
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    // With 2FA on, the password alone buys nothing more than a short-lived
    // challenge; no session exists until the second factor is proven.
    if (user.twoFactorEnabled) {
      return {
        requiresTwoFactor: true as const,
        challengeToken: generateTwoFactorChallenge(user.id)
      };
    }

    const tokens = await this.createSession(user.id, user.email, user.role, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress
    });

    let company = user.company;
    if (!company) {
      const businessName =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        user.email.split('@')[0] ||
        'My Business';

      company = await prisma.company.create({
        data: {
          userId: user.id,
          name: businessName,
          invoicePrefix: 'INV-',
          nextInvoiceNumber: 1001,
          country: 'India'
        }
      });
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: company.id,
        name: company.name,
        invoicePrefix: company.invoicePrefix
      },
      ...tokens
    };
  }

  /**
   * Second half of a two-factor login: the challenge proves the password was
   * already accepted, the code proves possession of the authenticator.
   */
  static async completeTwoFactorLogin(input: {
    challengeToken: string;
    code: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    let userId: string;
    try {
      ({ userId } = verifyTwoFactorChallenge(input.challengeToken));
    } catch {
      throw AppError.unauthorized('Your sign-in attempt expired. Enter your password again.');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { company: true }
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const isValid = await AccountSecurityService.verifyLoginChallenge(userId, input.code);
    if (!isValid) {
      throw AppError.unauthorized('That code is not valid. Try again or use a recovery code.');
    }

    const tokens = await this.createSession(user.id, user.email, user.role, {
      userAgent: input.userAgent,
      ipAddress: input.ipAddress
    });

    const company = user.company ?? (await this.ensureCompany(user));

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: company.id,
        name: company.name,
        invoicePrefix: company.invoicePrefix
      },
      ...tokens
    };
  }

  /**
   * Issues a session for a user who has just proven themselves some other way -
   * currently, by following an invitation link.
   */
  static async issueSessionFor(
    user: { id: string; email: string; firstName: string; lastName: string; role: string },
    companyId: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ) {
    const tokens = await this.createSession(user.id, user.email, user.role, meta);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, invoicePrefix: true }
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: company ?? { id: companyId, name: '', invoicePrefix: 'INV-' },
      ...tokens
    };
  }

  /** Creates the business a brand new account starts with. */
  private static async ensureCompany(user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  }) {
    const businessName =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      user.email.split('@')[0] ||
      'My Business';

    return prisma.company.create({
      data: {
        userId: user.id,
        name: businessName,
        invoicePrefix: 'INV-',
        nextInvoiceNumber: 1001,
        country: 'India'
      }
    });
  }

  static async refresh(refreshToken: string, meta?: { userAgent?: string; ipAddress?: string }) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }

    const hashed = hashToken(refreshToken);

    const session = await prisma.session.findUnique({
      where: { refreshTokenHash: hashed },
      include: { user: { include: { company: true } } }
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw AppError.unauthorized('Session has expired or been revoked');
    }

    if (!session.user || !session.user.isActive) {
      throw AppError.unauthorized('User account is disabled');
    }

    // Refresh Token Rotation: Revoke previous session
    await prisma.session.update({
      where: { id: session.id },
      data: { isRevoked: true }
    });

    // Create new session & new tokens
    const tokens = await this.createSession(
      session.user.id,
      session.user.email,
      session.user.role,
      meta
    );

    let company = session.user.company;
    if (!company) {
      const businessName =
        `${session.user.firstName || ''} ${session.user.lastName || ''}`.trim() ||
        session.user.email.split('@')[0] ||
        'My Business';

      company = await prisma.company.create({
        data: {
          userId: session.user.id,
          name: businessName,
          invoicePrefix: 'INV-',
          nextInvoiceNumber: 1001,
          country: 'India'
        }
      });
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        role: session.user.role
      },
      company: {
        id: company.id,
        name: company.name,
        invoicePrefix: company.invoicePrefix
      },
      ...tokens
    };
  }

  static async logout(sessionId?: string, refreshToken?: string) {
    if (sessionId) {
      await prisma.session.updateMany({
        where: { id: sessionId },
        data: { isRevoked: true }
      });
    } else if (refreshToken) {
      const hashed = hashToken(refreshToken);
      await prisma.session.updateMany({
        where: { refreshTokenHash: hashed },
        data: { isRevoked: true }
      });
    }
    return true;
  }

  static async getCurrentUser(userId: string) {
    const twoFactor = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true }
    });

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        company: {
          include: {
            invoiceSettings: true
          }
        }
      }
    });

    if (!user) {
      throw AppError.notFound('User not found');
    }

    // An invited collaborator owns no company of their own; the business they
    // work in comes from their membership. Creating one for them here would
    // silently strand them in an empty second business.
    let companyRole: string = user.role;

    if (!user.company) {
      const membership = await prisma.companyMember.findFirst({
        where: { userId: user.id, status: MemberStatus.ACTIVE },
        orderBy: { acceptedAt: 'asc' },
        select: {
          role: true,
          company: { include: { invoiceSettings: true } }
        }
      });

      if (membership) {
        companyRole = membership.role;
        user = { ...user, company: membership.company };
      } else {
        const businessName =
          `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
          user.email.split('@')[0] ||
          'My Business';

        const company = await prisma.company.create({
          data: {
            userId: user.id,
            name: businessName,
            email: user.email.toLowerCase(),
            invoicePrefix: 'INV-',
            nextInvoiceNumber: 1001,
            country: 'India'
          },
          include: {
            invoiceSettings: true
          }
        });

        companyRole = UserRole.OWNER;
        user = { ...user, company };
      }
    } else {
      companyRole = UserRole.OWNER;
    }

    if (user.company && !user.company.invoiceSettings) {
      const invoiceSettings = await prisma.invoiceSettings.upsert({
        where: { companyId: user.company.id },
        update: {},
        create: { companyId: user.company.id }
      });
      user = {
        ...user,
        company: {
          ...user.company,
          invoiceSettings
        }
      };
    }

    if (user.company) {
      user = {
        ...user,
        company: decryptObject(user.company, ['gstin', 'pan', 'accountNumber', 'upiId'])
      };
    }

    // The client mirrors these to hide actions the server would reject anyway.
    return {
      ...user,
      companyRole,
      permissions: permissionsFor(companyRole),
      twoFactorEnabled: twoFactor?.twoFactorEnabled ?? false
    };
  }

  private static async createSession(
    userId: string,
    email: string,
    role: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ) {
    const session = await prisma.session.create({
      data: {
        userId,
        refreshTokenHash: 'temp_' + Date.now() + '_' + Math.random(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent: meta?.userAgent || null,
        ipAddress: meta?.ipAddress || null
      }
    });

    const accessToken = generateAccessToken({ userId, email, role, sessionId: session.id });
    const refreshToken = generateRefreshToken({ userId, email, role, sessionId: session.id });

    const hashedRefresh = hashToken(refreshToken);

    await prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashedRefresh }
    });

    return {
      accessToken,
      refreshToken
    };
  }
}
