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
import { JwtService } from '@nestjs/jwt';
import { type UserRole as UserRoleValue } from '../generated/prisma/enums';
import { type User } from '../generated/prisma/client';
import { UsersService } from '../users/users.service';

type AuthFlowMode = 'login' | 'signup';

type AuthFlowState = {
  mode: AuthFlowMode;
  role?: UserRoleValue;
  redirectTo?: string;
  nonce?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email_verified?: boolean;
};

export type GoogleAuthProfile = {
  sub: string;
  email: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
  emailVerified: boolean;
};

type GoogleAuthAccount = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export type GoogleCallbackResult = {
  action: 'login' | 'signup';
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  appAccessToken: string;
  refreshToken: string;
  account: GoogleAuthAccount;
  profile: GoogleAuthProfile;
  googleAccessToken: string;
  googleIdToken: string | null;
  googleRefreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
};

@Injectable()
export class GoogleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];

  private readonly authorizationEndpoint =
    'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';
  private readonly userInfoEndpoint =
    'https://openidconnect.googleapis.com/v1/userinfo';

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {
    this.clientId = this.getRequiredEnv('GOOGLE_CLIENT_ID');
    this.clientSecret = this.getRequiredEnv('GOOGLE_CLIENT_SECRET');
    this.redirectUri = this.getRequiredEnv('GOOGLE_REDIRECT_URI');
    this.scopes = this.getConfiguredScopes();
  }

  getLoginUrl(state?: string): string {
    return this.getAuthorizationUrl(
      this.encodeState({
        mode: 'login',
        nonce: state,
      }),
    );
  }

  getSignupUrl(role: UserRoleValue, state?: string): string {
    return this.getAuthorizationUrl(
      this.encodeState({
        mode: 'signup',
        role,
        nonce: state,
      }),
    );
  }

  async handleGoogleCallback(
    code: string,
    rawState?: string,
  ): Promise<GoogleCallbackResult> {
    if (!code) {
      throw new BadRequestException('Missing Google authorization code');
    }

    const authState = this.decodeState(rawState);
    const tokenResponse = await this.exchangeCodeForTokens(code);
    const accessToken = tokenResponse.access_token;

    if (!accessToken) {
      throw new UnauthorizedException('Google access token was not returned');
    }

    const profile = await this.getProfile(accessToken);

    if (!profile.email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Google account email is missing or not verified',
      );
    }

    const existingUser = await this.usersService.findGoogleUser(profile);

    let user: User;
    let action: AuthFlowMode;

    if (authState.mode === 'signup') {
      if (existingUser) {
        throw new ConflictException(
          'A user with this Google account already exists. Use login instead.',
        );
      }

      if (!authState.role) {
        throw new BadRequestException(
          'Signup requires a role of LOAN_OFFICER or GENERAL_MANAGER.',
        );
      }

      user = await this.usersService.createGoogleUser(profile, authState.role);
      action = 'signup';
    } else {
      let resolvedUser: User | null = existingUser;

      if (!resolvedUser) {
        resolvedUser =
          await this.usersService.linkGoogleIdentityByEmail(profile);
      }

      if (!resolvedUser) {
        throw new NotFoundException(
          'No user is registered for this Google account. Use signup first.',
        );
      }

      resolvedUser = await this.usersService.updateGoogleUser(profile);
      user = resolvedUser;
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
        sub: profile.sub,
        email: profile.email,
        emailVerified: profile.emailVerified,
        name: profile.name,
      },
      profile,
      googleAccessToken: accessToken,
      googleIdToken: tokenResponse.id_token ?? null,
      googleRefreshToken: tokenResponse.refresh_token ?? null,
      expiresIn: tokenResponse.expires_in ?? null,
      scopes: (tokenResponse.scope ?? '')
        .split(' ')
        .map((scope) => scope.trim())
        .filter(Boolean),
    };
  }

  private getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    });

    if (state) {
      params.set('state', state);
    }

    return `${this.authorizationEndpoint}?${params.toString()}`;
  }

  private async exchangeCodeForTokens(code: string) {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const payload = (await response.json()) as GoogleTokenResponse;

    if (!response.ok || !payload.access_token) {
      throw new UnauthorizedException(
        payload.error_description ??
          payload.error ??
          'Failed to exchange Google authorization code',
      );
    }

    return payload;
  }

  private async getProfile(accessToken: string): Promise<GoogleAuthProfile> {
    const response = await fetch(this.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Failed to fetch Google user profile');
    }

    const payload = (await response.json()) as GoogleUserInfo;

    if (!payload.sub) {
      throw new UnauthorizedException('Google profile is missing sub');
    }

    return {
      sub: payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
      givenName: payload.given_name ?? null,
      familyName: payload.family_name ?? null,
      picture: payload.picture ?? null,
      emailVerified: payload.email_verified === true,
    };
  }

  private getConfiguredScopes(): string[] {
    const configuredScopes = this.configService.get<string>('GOOGLE_SCOPES');

    if (!configuredScopes) {
      return ['openid', 'profile', 'email'];
    }

    const scopes = configuredScopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (scopes.length === 0) {
      throw new InternalServerErrorException(
        'GOOGLE_SCOPES is configured but empty',
      );
    }

    return scopes;
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new InternalServerErrorException(`${key} is not configured`);
    }

    return value;
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
    } catch {
      throw new BadRequestException('Invalid Google auth state');
    }
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
