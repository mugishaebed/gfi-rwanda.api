import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  type UserRole as UserRoleValue,
  UserRole,
} from '../generated/prisma/enums';

type MicrosoftUserProfile = {
  oid: string | null;
  tenantId: string | null;
  email: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findMicrosoftUser(profile: Pick<MicrosoftUserProfile, 'oid'>) {
    if (!profile.oid) {
      throw new Error('Microsoft profile is missing oid');
    }

    return this.prisma.user.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'MICROSOFT',
          providerUserId: profile.oid,
        },
      },
    });
  }

  async createMicrosoftUser(
    profile: MicrosoftUserProfile,
    role: UserRoleValue,
  ) {
    if (!profile.oid) {
      throw new Error('Microsoft profile is missing oid');
    }

    if (!profile.email) {
      throw new Error('Microsoft profile is missing email');
    }

    const displayName =
      profile.name ??
      [profile.givenName, profile.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() ??
      profile.email;

    return this.prisma.user.create({
      data: {
        provider: 'MICROSOFT',
        providerUserId: profile.oid,
        tenantId: profile.tenantId,
        email: profile.email,
        name: displayName || profile.email,
        role,
      },
    });
  }

  async updateMicrosoftUser(profile: MicrosoftUserProfile) {
    if (!profile.oid) {
      throw new Error('Microsoft profile is missing oid');
    }

    if (!profile.email) {
      throw new Error('Microsoft profile is missing email');
    }

    const displayName =
      profile.name ??
      [profile.givenName, profile.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() ??
      profile.email;

    return this.prisma.user.update({
      where: {
        provider_providerUserId: {
          provider: 'MICROSOFT',
          providerUserId: profile.oid,
        },
      },
      data: {
        tenantId: profile.tenantId,
        email: profile.email,
        name: displayName || profile.email,
      },
    });
  }

  async storeRefreshToken(
    userId: string,
    refreshTokenHash: string,
    refreshTokenExpiresAt: Date,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash,
        refreshTokenExpiresAt,
      },
    });
  }

  async clearRefreshToken(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  }

  isAllowedRole(role: string): role is UserRoleValue {
    return role === UserRole.LOAN_OFFICER || role === UserRole.GENERAL_MANAGER;
  }
}
