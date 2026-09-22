import crypto from 'crypto';
import { MemberStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { hashToken } from '../utils/jwt.js';
import { hashPassword } from '../utils/password.js';
import { sendEmail, renderEmailShell, escapeHtml } from '../utils/email.js';
import { config } from '../config/index.js';
import { roleRank } from '../middleware/permissions.js';

/**
 * Team membership.
 *
 * A business is owned by exactly one user (`Company.userId`); everyone else
 * reaches it through a `CompanyMember` row. That row is written when the invite
 * is sent, before the invitee necessarily has an account, so a membership is
 * identified by email until it is accepted.
 */

const INVITE_TTL_DAYS = 7;

export interface TeamMemberView {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  role: UserRole;
  status: MemberStatus;
  isOwner: boolean;
  invitedAt: Date | null;
  acceptedAt: Date | null;
}

export class TeamService {
  /** The owner, followed by every membership row. */
  static async list(companyId: string): Promise<TeamMemberView[]> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true
          }
        },
        members: {
          orderBy: { invitedAt: 'asc' },
          select: {
            id: true,
            userId: true,
            email: true,
            role: true,
            status: true,
            invitedAt: true,
            acceptedAt: true,
            user: { select: { firstName: true, lastName: true } }
          }
        }
      }
    });

    if (!company) throw AppError.notFound('Business profile not found');

    const owner: TeamMemberView = {
      id: `owner:${company.user.id}`,
      userId: company.user.id,
      name: `${company.user.firstName} ${company.user.lastName}`.trim() || company.user.email,
      email: company.user.email,
      role: UserRole.OWNER,
      status: MemberStatus.ACTIVE,
      isOwner: true,
      invitedAt: company.createdAt,
      acceptedAt: company.user.createdAt
    };

    const members: TeamMemberView[] = company.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name:
        `${member.user?.firstName ?? ''} ${member.user?.lastName ?? ''}`.trim() ||
        member.email.split('@')[0],
      email: member.email,
      role: member.role,
      status: member.status,
      isOwner: false,
      invitedAt: member.invitedAt,
      acceptedAt: member.acceptedAt
    }));

    return [owner, ...members];
  }

  /**
   * Invites someone, or re-issues the invite if they were invited before and
   * never accepted. Re-inviting rotates the token, which also kills the link
   * from the earlier email.
   */
  static async invite(input: {
    companyId: string;
    invitedById: string;
    email: string;
    role: UserRole;
  }): Promise<{ member: TeamMemberView; inviteUrl: string; emailSent: boolean }> {
    const email = input.email.trim().toLowerCase();

    if (input.role === UserRole.OWNER) {
      throw AppError.badRequest('A business can only have one owner');
    }

    const company = await prisma.company.findUnique({
      where: { id: input.companyId },
      select: {
        name: true,
        user: { select: { email: true } },
        invoiceSettings: { select: { themeColor: true } }
      }
    });

    if (!company) throw AppError.notFound('Business profile not found');

    if (company.user.email.toLowerCase() === email) {
      throw AppError.conflict('This email already owns the business');
    }

    const existing = await prisma.companyMember.findUnique({
      where: { companyId_email: { companyId: input.companyId, email } },
      select: { id: true, status: true }
    });

    if (existing?.status === MemberStatus.ACTIVE) {
      throw AppError.conflict('This person is already on your team');
    }

    // The invitee may already have an account; linking it now makes accepting
    // one click instead of a second signup.
    const invitedUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const data = {
      companyId: input.companyId,
      email,
      role: input.role,
      status: MemberStatus.INVITED,
      userId: invitedUser?.id ?? null,
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: expiresAt,
      invitedById: input.invitedById,
      invitedAt: new Date(),
      acceptedAt: null
    };

    const member = existing
      ? await prisma.companyMember.update({ where: { id: existing.id }, data })
      : await prisma.companyMember.create({ data });

    const inviteUrl = `${config.appUrl}/accept-invite?token=${token}`;

    const result = await sendEmail({
      to: email,
      subject: `You have been invited to ${company.name} on Invoice Maker`,
      fromName: company.name,
      html: renderEmailShell({
        heading: `Join ${escapeHtml(company.name)}`,
        accent: company.invoiceSettings?.themeColor ?? undefined,
        body: `<p style="margin:0 0 12px;">You have been invited to collaborate on <strong>${escapeHtml(
          company.name
        )}</strong> as <strong>${escapeHtml(input.role)}</strong>.</p>
               <p style="margin:0 0 12px;">This invitation expires in ${INVITE_TTL_DAYS} days.</p>`,
        cta: { label: 'Accept invitation', url: inviteUrl },
        footer: 'If you were not expecting this invitation you can safely ignore this email.'
      })
    });

    return {
      member: {
        id: member.id,
        userId: member.userId,
        name: email.split('@')[0],
        email: member.email,
        role: member.role,
        status: member.status,
        isOwner: false,
        invitedAt: member.invitedAt,
        acceptedAt: member.acceptedAt
      },
      // Returned so the inviter can copy the link when SMTP is not configured.
      inviteUrl,
      emailSent: result.sent
    };
  }

  /** Details for the accept-invite screen, shown before the user commits. */
  static async describeInvite(token: string) {
    const member = await prisma.companyMember.findUnique({
      where: { inviteTokenHash: hashToken(token) },
      select: {
        email: true,
        role: true,
        status: true,
        inviteExpiresAt: true,
        company: { select: { name: true } }
      }
    });

    if (!member || member.status === MemberStatus.SUSPENDED) {
      throw AppError.notFound('This invitation is no longer valid');
    }

    if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
      throw AppError.badRequest('This invitation has expired. Ask for a new one.');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: member.email },
      select: { id: true }
    });

    return {
      email: member.email,
      role: member.role,
      businessName: member.company.name,
      /** Tells the client whether to ask for a password or just a confirmation. */
      requiresSignup: !existingUser
    };
  }

  /**
   * Accepts an invitation, creating the user account when the invitee is new.
   *
   * Returns the user so the caller can issue a session: accepting an invite
   * logs you straight in, which is the point of the emailed link.
   */
  static async acceptInvite(input: {
    token: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }) {
    const member = await prisma.companyMember.findUnique({
      where: { inviteTokenHash: hashToken(input.token) },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        inviteExpiresAt: true,
        companyId: true
      }
    });

    if (!member || member.status === MemberStatus.SUSPENDED) {
      throw AppError.notFound('This invitation is no longer valid');
    }

    if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) {
      throw AppError.badRequest('This invitation has expired. Ask for a new one.');
    }

    let user = await prisma.user.findUnique({
      where: { email: member.email },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true }
    });

    if (!user) {
      if (!input.password || input.password.length < 8) {
        throw AppError.badRequest(
          'Choose a password of at least 8 characters to accept the invitation'
        );
      }

      user = await prisma.user.create({
        data: {
          email: member.email,
          passwordHash: await hashPassword(input.password),
          firstName: input.firstName?.trim() || member.email.split('@')[0],
          lastName: input.lastName?.trim() || '',
          // The account-level role mirrors the membership, so a member who never
          // owns a business still carries a sensible role on their own record.
          role: member.role,
          isEmailVerified: true
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true
        }
      });
    }

    if (!user.isActive) {
      throw AppError.unauthorized('This account has been disabled');
    }

    await prisma.companyMember.update({
      where: { id: member.id },
      data: {
        userId: user.id,
        status: MemberStatus.ACTIVE,
        acceptedAt: new Date(),
        // Burn the token: the link is single use.
        inviteTokenHash: null,
        inviteExpiresAt: null
      }
    });

    return { user, companyId: member.companyId, role: member.role };
  }

  static async updateRole(input: {
    companyId: string;
    memberId: string;
    role: UserRole;
  }): Promise<TeamMemberView> {
    if (input.role === UserRole.OWNER) {
      throw AppError.badRequest('Ownership cannot be reassigned from this screen');
    }

    const member = await prisma.companyMember.findFirst({
      where: { id: input.memberId, companyId: input.companyId },
      select: { id: true }
    });

    if (!member) throw AppError.notFound('Team member not found');

    const updated = await prisma.companyMember.update({
      where: { id: member.id },
      data: { role: input.role },
      select: {
        id: true,
        userId: true,
        email: true,
        role: true,
        status: true,
        invitedAt: true,
        acceptedAt: true,
        user: { select: { firstName: true, lastName: true } }
      }
    });

    return {
      id: updated.id,
      userId: updated.userId,
      name:
        `${updated.user?.firstName ?? ''} ${updated.user?.lastName ?? ''}`.trim() ||
        updated.email.split('@')[0],
      email: updated.email,
      role: updated.role,
      status: updated.status,
      isOwner: false,
      invitedAt: updated.invitedAt,
      acceptedAt: updated.acceptedAt
    };
  }

  /** Removes access. The user account itself is left alone. */
  static async remove(companyId: string, memberId: string): Promise<void> {
    const member = await prisma.companyMember.findFirst({
      where: { id: memberId, companyId },
      select: { id: true }
    });

    if (!member) throw AppError.notFound('Team member not found');

    await prisma.companyMember.delete({ where: { id: member.id } });
  }

  /** The roles the caller may hand out - never one above their own. */
  static assignableRoles(callerRole: string | undefined): UserRole[] {
    return [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.STAFF].filter(
      (role) => roleRank(role) <= roleRank(callerRole)
    );
  }
}
