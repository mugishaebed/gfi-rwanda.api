import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Query,
  Redirect,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MsalAuthService } from './msal-auth.service';
import { UserRole } from '../generated/prisma/enums';
import { LogoutDto, RefreshTokenDto } from './dto/token.dto';

@ApiTags('Auth')
@Controller({
  path: 'auth',
  version: VERSION_NEUTRAL,
})
export class AuthController {
  constructor(private readonly authService: MsalAuthService) {}

  @Get('test')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  testPage() {
    if (process.env.NODE_ENV !== 'development') {
      throw new NotFoundException();
    }

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auth Test — GFI Rwanda</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --green-50:  #f0fdf4;
        --green-100: #dcfce7;
        --green-200: #bbf7d0;
        --green-500: #22c55e;
        --green-600: #16a34a;
        --green-700: #15803d;
        --green-800: #166534;
        --red-50:    #fef2f2;
        --red-200:   #fecaca;
        --red-600:   #dc2626;
        --red-700:   #b91c1c;
        --ink:       #111827;
        --muted:     #6b7280;
        --line:      #e5e7eb;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        min-height: 100dvh;
        background: linear-gradient(160deg, #ffffff 0%, var(--green-50) 55%, var(--green-100) 100%);
        color: var(--ink);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px 20px 80px;
      }

      main { width: 100%; max-width: 900px; }

      /* ── Header ── */
      .header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 8px;
      }
      .logo {
        width: 42px; height: 42px;
        background: var(--green-600);
        border-radius: 11px;
        display: grid; place-items: center;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(22,163,74,0.3);
      }
      .logo svg { width: 22px; height: 22px; }
      .header-text h1 {
        font-size: 1.4rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--green-800);
      }
      .header-text p { font-size: 0.85rem; color: var(--muted); margin-top: 1px; }

      /* ── Meta row ── */
      .meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 14px 0 28px;
        flex-wrap: wrap;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        background: var(--green-100);
        color: var(--green-700);
        border: 1px solid var(--green-200);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .badge::before {
        content: '';
        width: 5px; height: 5px;
        border-radius: 50%;
        background: var(--green-500);
      }
      .route-chip {
        padding: 3px 9px;
        border-radius: 7px;
        background: white;
        border: 1px solid var(--line);
        font-size: 0.74rem;
        font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
        color: var(--green-700);
        font-weight: 500;
      }

      /* ── Section label ── */
      .section-label {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 10px;
        padding-left: 2px;
      }

      /* ── Grid ── */
      .grid-2 {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 14px;
        margin-bottom: 14px;
      }

      /* ── Card ── */
      .card {
        background: #ffffff;
        border: 1px solid var(--green-200);
        border-radius: 16px;
        padding: 22px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(22,163,74,0.06);
        transition: box-shadow 0.18s, transform 0.18s;
      }
      .card:hover {
        box-shadow: 0 2px 6px rgba(0,0,0,0.06), 0 8px 22px rgba(22,163,74,0.10);
        transform: translateY(-1px);
      }
      .card.danger {
        border-color: var(--red-200);
        box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(220,38,38,0.05);
      }
      .card.danger:hover {
        box-shadow: 0 2px 6px rgba(0,0,0,0.06), 0 8px 22px rgba(220,38,38,0.09);
        transform: translateY(-1px);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 11px;
        margin-bottom: 18px;
      }
      .icon-wrap {
        width: 34px; height: 34px;
        border-radius: 9px;
        background: var(--green-50);
        border: 1px solid var(--green-200);
        display: grid; place-items: center;
        flex-shrink: 0;
      }
      .icon-wrap svg { width: 16px; height: 16px; stroke: var(--green-600); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .card.danger .icon-wrap { background: var(--red-50); border-color: var(--red-200); }
      .card.danger .icon-wrap svg { stroke: var(--red-600); }

      .card-title { font-size: 0.95rem; font-weight: 600; color: var(--ink); }
      .card-desc  { font-size: 0.8rem; color: var(--muted); margin-top: 2px; line-height: 1.4; }

      /* ── Form fields ── */
      .field { margin-bottom: 12px; }
      .field:last-of-type { margin-bottom: 0; }
      label {
        display: block;
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--ink);
        margin-bottom: 5px;
        letter-spacing: 0.01em;
      }
      .field-hint { font-size: 0.73rem; color: var(--muted); margin-bottom: 5px; line-height: 1.4; }
      input, select {
        width: 100%;
        padding: 9px 12px;
        border-radius: 9px;
        border: 1px solid var(--line);
        font: inherit;
        font-size: 0.84rem;
        color: var(--ink);
        background: var(--green-50);
        outline: none;
        transition: border-color 0.14s, box-shadow 0.14s;
        appearance: none;
      }
      input:focus, select:focus {
        border-color: var(--green-500);
        box-shadow: 0 0 0 3px rgba(34,197,94,0.14);
      }
      select {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 11px center;
        padding-right: 32px;
        cursor: pointer;
      }

      /* ── Buttons ── */
      .actions { margin-top: 16px; }
      button {
        appearance: none;
        border: 0;
        border-radius: 9px;
        padding: 9px 18px;
        background: var(--green-600);
        color: #fff;
        font: inherit;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background 0.14s, transform 0.1s, box-shadow 0.14s;
        box-shadow: 0 1px 3px rgba(22,163,74,0.25);
      }
      button:hover  { background: var(--green-700); box-shadow: 0 2px 6px rgba(22,163,74,0.3); }
      button:active { transform: scale(0.97); }
      button.danger { background: var(--red-600); box-shadow: 0 1px 3px rgba(220,38,38,0.25); }
      button.danger:hover { background: var(--red-700); box-shadow: 0 2px 6px rgba(220,38,38,0.3); }
      button svg { width: 14px; height: 14px; flex-shrink: 0; }

      /* ── Divider ── */
      .divider { height: 1px; background: var(--line); margin: 20px 0; }

      /* ── Footer ── */
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        background: white;
        border: 1px solid var(--green-200);
        border-radius: 13px;
        padding: 14px 18px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      }
      .footer p { font-size: 0.82rem; color: var(--muted); line-height: 1.5; flex: 1; min-width: 200px; }
      .footer a {
        border: 1.5px solid var(--green-500);
        border-radius: 9px;
        padding: 7px 14px;
        background: transparent;
        color: var(--green-700);
        font: inherit;
        font-size: 0.82rem;
        font-weight: 600;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background 0.14s;
        white-space: nowrap;
      }
      .footer a:hover { background: var(--green-50); }
      .footer a svg { width: 13px; height: 13px; }
    </style>
  </head>
  <body>
    <main>

      <header class="header">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="header-text">
          <h1>Auth Test</h1>
          <p>GFI Rwanda API — development sandbox</p>
        </div>
      </header>

      <div class="meta">
        <span class="badge">development only</span>
        <span class="route-chip">GET /auth/microsoft/login</span>
        <span class="route-chip">GET /auth/microsoft/signup</span>
        <span class="route-chip">GET /auth/microsoft/callback</span>
        <span class="route-chip">GET /auth/microsoft/logout</span>
      </div>

      <!-- ── Authentication ── -->
      <p class="section-label">Authentication</p>
      <div class="grid-2">

        <!-- Login -->
        <section class="card">
          <div class="card-header">
            <div class="icon-wrap">
              <svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            </div>
            <div>
              <div class="card-title">Login</div>
              <div class="card-desc">Existing user — no account created.</div>
            </div>
          </div>
          <div class="field">
            <label for="login-state">State <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
            <div class="field-hint">Echoed back by Microsoft — use to verify round-trip integrity.</div>
            <input id="login-state" placeholder="e.g. frontend-route-/dashboard" />
          </div>
          <div class="actions">
            <button type="button" onclick="startLogin()">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              Sign in with Microsoft
            </button>
          </div>
        </section>

        <!-- Signup -->
        <section class="card">
          <div class="card-header">
            <div class="icon-wrap">
              <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            </div>
            <div>
              <div class="card-title">Sign Up</div>
              <div class="card-desc">New user — creates account with selected role.</div>
            </div>
          </div>
          <div class="field">
            <label for="signup-role">Role <span style="font-weight:400;color:var(--red-600)">*required</span></label>
            <div class="field-hint">Determines the user's permissions in the system.</div>
            <select id="signup-role">
              <option value="" disabled selected>Select a role…</option>
              <option value="LOAN_OFFICER">Loan Officer</option>
              <option value="GENERAL_MANAGER">General Manager</option>
            </select>
          </div>
          <div class="field">
            <label for="signup-state">State <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
            <input id="signup-state" placeholder="e.g. signup-flow-abc" />
          </div>
          <div class="actions">
            <button type="button" onclick="startSignup()">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Create account
            </button>
          </div>
        </section>

      </div>

      <!-- ── Session ── -->
      <p class="section-label" style="margin-top:20px">Session</p>
      <div class="grid-2">

        <!-- Logout -->
        <section class="card danger">
          <div class="card-header">
            <div class="icon-wrap">
              <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </div>
            <div>
              <div class="card-title">Logout</div>
              <div class="card-desc">Ends the session and redirects via Microsoft.</div>
            </div>
          </div>
          <div class="field">
            <label for="post-logout-uri">Post-logout redirect URI <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
            <div class="field-hint">Where Microsoft sends the user after sign-out.</div>
            <input id="post-logout-uri" value="http://localhost:3000/auth/test" />
          </div>
          <div class="actions">
            <button type="button" class="danger" onclick="startLogout()">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign out
            </button>
          </div>
        </section>

      </div>

      <div class="divider"></div>

      <footer class="footer">
        <p>After sign-in the callback returns JSON — token payload and normalized Microsoft profile appear directly in the browser.</p>
        <a href="/docs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          Scalar Docs
        </a>
      </footer>

    </main>

    <script>
      function startLogin() {
        const state = document.getElementById('login-state').value.trim();
        const url = new URL('/auth/microsoft/login', window.location.origin);
        if (state) url.searchParams.set('state', state);
        window.location.href = url.toString();
      }

      function startSignup() {
        const role = document.getElementById('signup-role').value;
        const select = document.getElementById('signup-role');
        if (!role) {
          select.style.borderColor = 'var(--red-600)';
          select.focus();
          return;
        }
        const state = document.getElementById('signup-state').value.trim();
        const url = new URL('/auth/microsoft/signup', window.location.origin);
        url.searchParams.set('role', role);
        if (state) url.searchParams.set('state', state);
        window.location.href = url.toString();
      }

      function startLogout() {
        const uri = document.getElementById('post-logout-uri').value.trim();
        const url = new URL('/auth/microsoft/logout', window.location.origin);
        if (uri) url.searchParams.set('postLogoutRedirectUri', uri);
        window.location.href = url.toString();
      }

      document.getElementById('signup-role').addEventListener('change', function () {
        this.style.borderColor = '';
      });
    </script>
  </body>
</html>`;
  }

  @Get('microsoft/login')
  @Redirect()
  @ApiOperation({
    summary: 'Redirect to Microsoft login',
    description: 'Starts the Microsoft login flow.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Optional state value preserved through the auth flow.',
  })
  async login(@Query('state') state?: string) {
    const url = await this.authService.getLoginUrl(state);
    return { url };
  }

  @Get('microsoft/signup')
  @Redirect()
  @ApiOperation({
    summary: 'Redirect to Microsoft signup',
    description: 'Starts Microsoft signup and assigns the selected role.',
  })
  @ApiQuery({
    name: 'role',
    required: true,
    enum: UserRole,
    description: 'Role to assign during signup.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Optional state value preserved through the auth flow.',
  })
  async signup(@Query('role') role?: string, @Query('state') state?: string) {
    if (role !== UserRole.LOAN_OFFICER && role !== UserRole.GENERAL_MANAGER) {
      throw new BadRequestException(
        'Role must be LOAN_OFFICER or GENERAL_MANAGER.',
      );
    }

    const url = await this.authService.getSignupUrl(role, state);
    return { url };
  }

  @Get('microsoft/callback')
  @ApiOperation({
    summary: 'Handle Microsoft auth callback',
    description: 'Completes Microsoft authentication and returns app tokens.',
  })
  @ApiQuery({
    name: 'code',
    required: true,
    description: 'Authorization code returned by Microsoft.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Optional state returned by Microsoft.',
  })
  async callback(@Query('code') code?: string, @Query('state') state?: string) {
    if (!code) {
      throw new BadRequestException('Missing authorization code');
    }

    return this.authService.handleMicrosoftCallback(code, state);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh app access token',
    description:
      'Uses a valid refresh token to rotate and issue a new app access token.',
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshAppToken(dto.refreshToken);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Revoke refresh token',
    description: 'Clears the stored refresh token for the given user.',
  })
  logoutApp(@Body() dto: LogoutDto) {
    return this.authService.revokeRefreshToken(dto.userId);
  }

  @Get('microsoft/logout')
  @Redirect()
  @ApiOperation({
    summary: 'Redirect to Microsoft logout',
    description: 'Logs the user out from the Microsoft session.',
  })
  @ApiQuery({
    name: 'postLogoutRedirectUri',
    required: false,
    description: 'Optional URL to redirect to after logout.',
  })
  logout(@Query('postLogoutRedirectUri') postLogoutRedirectUri?: string) {
    return { url: this.authService.getLogoutUrl(postLogoutRedirectUri) };
  }
}
