import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  type AuthProvider as AuthProviderValue,
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

type GoogleUserProfile = {
  sub: string | null;
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

    return this.findByIdentity('MICROSOFT', profile.oid);
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

    return this.createOrLinkIdentity({
      provider: 'MICROSOFT',
      providerUserId: profile.oid,
      tenantId: profile.tenantId,
      email: profile.email,
      displayName: displayName || profile.email,
      roleForNewUser: role,
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

    return this.updateByIdentity({
      provider: 'MICROSOFT',
      providerUserId: profile.oid,
      tenantId: profile.tenantId,
      email: profile.email,
      displayName: displayName || profile.email,
    });
  }

  async linkMicrosoftIdentityByEmail(profile: MicrosoftUserProfile) {
    if (!profile.oid || !profile.email) {
      return null;
    }

    return this.linkIdentityToExistingUser({
      provider: 'MICROSOFT',
      providerUserId: profile.oid,
      tenantId: profile.tenantId,
      email: profile.email,
      displayName:
        profile.name ??
        [profile.givenName, profile.familyName]
          .filter(Boolean)
          .join(' ')
          .trim() ??
        profile.email,
    });
  }

  async findGoogleUser(profile: Pick<GoogleUserProfile, 'sub'>) {
    if (!profile.sub) {
      throw new Error('Google profile is missing sub');
    }

    return this.findByIdentity('GOOGLE', profile.sub);
  }

  async createGoogleUser(profile: GoogleUserProfile, role: UserRoleValue) {
    if (!profile.sub) {
      throw new Error('Google profile is missing sub');
    }

    if (!profile.email) {
      throw new Error('Google profile is missing email');
    }

    const displayName =
      profile.name ??
      [profile.givenName, profile.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() ??
      profile.email;

    return this.createOrLinkIdentity({
      provider: 'GOOGLE',
      providerUserId: profile.sub,
      email: profile.email,
      displayName: displayName || profile.email,
      roleForNewUser: role,
    });
  }

  async updateGoogleUser(profile: GoogleUserProfile) {
    if (!profile.sub) {
      throw new Error('Google profile is missing sub');
    }

    if (!profile.email) {
      throw new Error('Google profile is missing email');
    }

    const displayName =
      profile.name ??
      [profile.givenName, profile.familyName]
        .filter(Boolean)
        .join(' ')
        .trim() ??
      profile.email;

    return this.updateByIdentity({
      provider: 'GOOGLE',
      providerUserId: profile.sub,
      email: profile.email,
      displayName: displayName || profile.email,
    });
  }

  async linkGoogleIdentityByEmail(profile: GoogleUserProfile) {
    if (!profile.sub || !profile.email) {
      return null;
    }

    return this.linkIdentityToExistingUser({
      provider: 'GOOGLE',
      providerUserId: profile.sub,
      email: profile.email,
      displayName:
        profile.name ??
        [profile.givenName, profile.familyName]
          .filter(Boolean)
          .join(' ')
          .trim() ??
        profile.email,
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

  private async findByIdentity(
    provider: AuthProviderValue,
    providerUserId: string,
  ) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: { user: true },
    });

    return identity?.user ?? null;
  }

  private async createOrLinkIdentity(params: {
    provider: AuthProviderValue;
    providerUserId: string;
    tenantId?: string | null;
    email: string;
    displayName: string;
    roleForNewUser: UserRoleValue;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: params.provider,
            providerUserId: params.providerUserId,
          },
        },
      });

      if (existingIdentity) {
        return tx.user.update({
          where: { id: existingIdentity.userId },
          data: {
            email: params.email,
            name: params.displayName,
          },
        });
      }

      const existingUser = await tx.user.findUnique({
        where: { email: params.email },
      });

      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              email: params.email,
              name: params.displayName,
            },
          })
        : await tx.user.create({
            data: {
              email: params.email,
              name: params.displayName,
              role: params.roleForNewUser,
            },
          });

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: params.provider,
          providerUserId: params.providerUserId,
          tenantId: params.tenantId ?? null,
        },
      });

      return user;
    });
  }

  private async updateByIdentity(params: {
    provider: AuthProviderValue;
    providerUserId: string;
    tenantId?: string | null;
    email: string;
    displayName: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: params.provider,
            providerUserId: params.providerUserId,
          },
        },
      });

      if (!identity) {
        throw new Error(
          `${params.provider} identity is not linked to any user account`,
        );
      }

      if (params.provider === 'MICROSOFT') {
        await tx.authIdentity.update({
          where: { id: identity.id },
          data: { tenantId: params.tenantId ?? null },
        });
      }

      return tx.user.update({
        where: { id: identity.userId },
        data: {
          email: params.email,
          name: params.displayName,
        },
      });
    });
  }

  private async linkIdentityToExistingUser(params: {
    provider: AuthProviderValue;
    providerUserId: string;
    tenantId?: string | null;
    email: string;
    displayName: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: params.provider,
            providerUserId: params.providerUserId,
          },
        },
      });

      if (existingIdentity) {
        return tx.user.update({
          where: { id: existingIdentity.userId },
          data: {
            email: params.email,
            name: params.displayName,
          },
        });
      }

      const existingUser = await tx.user.findUnique({
        where: { email: params.email },
      });

      if (!existingUser) {
        return null;
      }

      await tx.authIdentity.create({
        data: {
          userId: existingUser.id,
          provider: params.provider,
          providerUserId: params.providerUserId,
          tenantId: params.tenantId ?? null,
        },
      });

      return tx.user.update({
        where: { id: existingUser.id },
        data: {
          name: params.displayName,
        },
      });
    });
  }
}
