import { prisma } from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken
} from '../utils/jwt.js';
import { AppError } from '../utils/error.js';

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  businessName: string;
  phone?: string;
  gstin?: string;
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

    // Create User & Company in a single atomic transaction
    const result = await prisma.$transaction(async (tx) => {
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
          phone: input.phone || null,
          gstin: input.gstin || null,
          invoicePrefix: 'INV-',
          nextInvoiceNumber: 1001
        }
      });

      return { user, company };
    });

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
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        company: true
      }
    });

    if (!user) {
      throw AppError.notFound('User not found');
    }

    if (!user.company) {
      const businessName =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
        user.email.split('@')[0] ||
        'My Business';

      const company = await prisma.company.create({
        data: {
          userId: user.id,
          name: businessName,
          invoicePrefix: 'INV-',
          nextInvoiceNumber: 1001,
          country: 'India'
        }
      });

      user = {
        ...user,
        company
      };
    }

    return user;
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
