import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  ConfidentialClientApplication,
  type IdTokenClaims,
  LogLevel,
  type AuthorizationCodeRequest,
  type AuthorizationUrlRequest,
  type Configuration,
} from '@azure/msal-node';
import { UsersService } from '../users/users.service';
import { type User } from '../generated/prisma/client';
import { type UserRole as UserRoleValue } from '../generated/prisma/enums';
import { JwtService } from '@nestjs/jwt';

type MicrosoftAuthProfile = {
  oid: string | null;
  tenantId: string | null;
  email: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
};

type MicrosoftAuthAccount = {
  homeAccountId: string;
  localAccountId: string;
  username: string;
  tenantId: string | null;
  name: string | null;
};

export type MicrosoftCallbackResult = {
  action: 'login' | 'signup';
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  appAccessToken: string;
  refreshToken: string;
  account: MicrosoftAuthAccount;
  profile: MicrosoftAuthProfile;
  microsoftAccessToken: string;
  microsoftIdToken: string;
  expiresOn: string | null;
  scopes: string[];
};

export type RefreshTokenResult = {
  appAccessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
};

type AuthFlowMode = 'login' | 'signup';

type AuthFlowState = {
  mode: AuthFlowMode;
  role?: UserRoleValue;
  redirectTo?: string;
  nonce?: string;
};

@Injectable()
export class MsalAuthService {
  private readonly authority: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];
  private readonly client: ConfidentialClientApplication;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {
    const clientId = this.getRequiredEnv('MICROSOFT_CLIENT_ID');
    const clientSecret = this.getRequiredEnv('MICROSOFT_CLIENT_SECRET');
    const tenantId = this.getRequiredEnv('MICROSOFT_TENANT_ID');

    this.redirectUri = this.getRequiredEnv('MICROSOFT_REDIRECT_URI');
    this.authority = `https://login.microsoftonline.com/${tenantId}`;
    this.scopes = this.getConfiguredScopes();

    const config: Configuration = {
      auth: {
        clientId,
        clientSecret,
        authority: this.authority,
      },
      system: {
        loggerOptions: {
          loggerCallback: () => undefined,
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      },
    };

    this.client = new ConfidentialClientApplication(config);
  }

  async getAuthorizationUrl(state?: string): Promise<string> {
    const request: AuthorizationUrlRequest = {
      redirectUri: this.redirectUri,
      scopes: this.scopes,
      prompt: 'select_account',
      state,
    };

    return this.client.getAuthCodeUrl(request);
  }

  async getLoginUrl(state?: string): Promise<string> {
    return this.getAuthorizationUrl(
      this.encodeState({
        mode: 'login',
        nonce: state,
      }),
    );
  }

  async getSignupUrl(role: UserRoleValue, state?: string): Promise<string> {
    return this.getAuthorizationUrl(
      this.encodeState({
        mode: 'signup',
        role,
        nonce: state,
      }),
    );
  }

  async handleMicrosoftCallback(
    code: string,
    rawState?: string,
  ): Promise<MicrosoftCallbackResult> {
    if (!code) {
      throw new BadRequestException('Missing Microsoft authorization code');
    }

    const request: AuthorizationCodeRequest = {
      code,
      redirectUri: this.redirectUri,
      scopes: this.scopes,
    };

    const result = await this.client.acquireTokenByCode(request);

    if (!result || !result.account || !result.accessToken || !result.idToken) {
      throw new UnauthorizedException(
        'Microsoft authentication did not return the expected tokens',
      );
    }

    const claims = result.idTokenClaims;
    const authState = this.decodeState(rawState);
    const profile = {
      oid: this.getClaim(claims, 'oid') ?? null,
      tenantId: this.getClaim(claims, 'tid') ?? result.account.tenantId ?? null,
      email:
        this.getClaim(claims, 'preferred_username') ??
        this.getClaim(claims, 'email') ??
        result.account.username,
      name: this.getClaim(claims, 'name') ?? result.account.name ?? null,
      givenName: this.getClaim(claims, 'given_name') ?? null,
      familyName: this.getClaim(claims, 'family_name') ?? null,
    };
    const existingUser = await this.usersService.findMicrosoftUser(profile);

    let user: User;
    let action: AuthFlowMode;

    if (authState.mode === 'signup') {
      if (existingUser) {
        throw new ConflictException(
          'A user with this Microsoft account already exists. Use login instead.',
        );
      }

      if (!authState.role) {
        throw new BadRequestException(
          'Signup requires a role of LOAN_OFFICER or GENERAL_MANAGER.',
        );
      }

      user = await this.usersService.createMicrosoftUser(
        profile,
        authState.role,
      );
      action = 'signup';
    } else {
      if (!existingUser) {
        throw new NotFoundException(
          'No user is registered for this Microsoft account. Use signup first.',
        );
      }

      user = await this.usersService.updateMicrosoftUser(profile);
      action = 'login';
    }

    const { appAccessToken, refreshToken } = await this.issueTokens(user);

    return {
      action,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      appAccessToken,
      refreshToken,
      account: {
        homeAccountId: result.account.homeAccountId,
        localAccountId: result.account.localAccountId,
        username: result.account.username,
        tenantId:
          result.account.tenantId ?? this.getClaim(claims, 'tid') ?? null,
        name: result.account.name ?? this.getClaim(claims, 'name') ?? null,
      },
      profile,
      microsoftAccessToken: result.accessToken,
      microsoftIdToken: result.idToken,
      expiresOn: result.expiresOn?.toISOString() ?? null,
      scopes: result.scopes,
    };
  }

  async refreshAppToken(refreshToken: string): Promise<RefreshTokenResult> {
    const [userId] = refreshToken.split('.');

    if (!userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      !user.refreshTokenHash ||
      !user.refreshTokenExpiresAt ||
      user.refreshTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    const incomingTokenHash = this.hashToken(refreshToken);

    if (incomingTokenHash !== user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokens(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async revokeRefreshToken(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersService.clearRefreshToken(userId);

    return {
      message: 'Logged out successfully',
    };
  }

  getLogoutUrl(postLogoutRedirectUri?: string): string {
    const url = new URL(`${this.authority}/oauth2/v2.0/logout`);
    const redirectTarget =
      postLogoutRedirectUri ?? this.configService.get<string>('FRONTEND_URL');

    if (redirectTarget) {
      url.searchParams.set('post_logout_redirect_uri', redirectTarget);
    }

    return url.toString();
  }

  private getConfiguredScopes(): string[] {
    const configuredScopes = this.configService.get<string>('MICROSOFT_SCOPES');

    if (!configuredScopes) {
      return ['openid', 'profile', 'email', 'offline_access', 'User.Read'];
    }

    const scopes = configuredScopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (scopes.length === 0) {
      throw new InternalServerErrorException(
        'MICROSOFT_SCOPES is configured but empty',
      );
    }

    return scopes;
  }

  private encodeState(state: AuthFlowState): string {
    return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  }

  private decodeState(rawState?: string): AuthFlowState {
    if (!rawState) {
      return { mode: 'login' };
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(rawState, 'base64url').toString('utf8'),
      ) as Partial<AuthFlowState>;

      if (decoded.mode !== 'login' && decoded.mode !== 'signup') {
        return { mode: 'login' };
      }

      if (decoded.role && !this.usersService.isAllowedRole(decoded.role)) {
        throw new BadRequestException('Invalid signup role');
      }

      return {
        mode: decoded.mode,
        role: decoded.role,
        redirectTo: decoded.redirectTo,
        nonce: decoded.nonce,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Invalid Microsoft auth state');
    }
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new InternalServerErrorException(`${key} is not configured`);
    }

    return value;
  }

  private getClaim(
    claims: IdTokenClaims | undefined,
    key: string,
  ): string | null {
    const value = (claims as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'string' ? value : null;
  }

  private async signAppToken(user: User) {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private async issueTokens(user: User) {
    const appAccessToken = await this.signAppToken(user);
    const refreshToken = this.generateRefreshToken(user.id);
    const refreshTokenHash = this.hashToken(refreshToken);
    const refreshTokenExpiresAt = this.getRefreshTokenExpiryDate();

    await this.usersService.storeRefreshToken(
      user.id,
      refreshTokenHash,
      refreshTokenExpiresAt,
    );

    return {
      appAccessToken,
      refreshToken,
    };
  }

  private generateRefreshToken(userId: string) {
    return `${userId}.${randomBytes(48).toString('hex')}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiryDate() {
    const days = Number(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN_DAYS') ?? '30',
    );

    if (!Number.isFinite(days) || days <= 0) {
      throw new InternalServerErrorException(
        'REFRESH_TOKEN_EXPIRES_IN_DAYS must be a positive number',
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    return expiresAt;
  }
}
