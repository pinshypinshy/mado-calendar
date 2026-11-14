// 管理者のログイン（要件 3.1、7.4）。
// Google の OAuth を自前で実装し、ログインと同時にカレンダーを読むためのリフレッシュトークンを受け取る。

import { AppError } from '../errors';
import { sha256Base64url } from '../lib/encoding';
import type { Clock, OAuthProvider, Random, Repositories, SecretBox } from '../ports';

export const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface AdminAuthDeps {
  repos: Pick<Repositories, 'adminSessions' | 'tokens'>;
  oauth: OAuthProvider;
  secretBox: SecretBox;
  random: Random;
  clock: Clock;
  adminEmail: string;
}

export class AdminAuthService {
  constructor(private readonly d: AdminAuthDeps) {}

  /** @returns Google の認可画面の URL と、Cookie に入れる値（state と PKCE の verifier） */
  async startLogin(redirectUri: string): Promise<{ url: string; stateCookie: string }> {
    const state = this.d.random.token();
    const verifier = this.d.random.token();
    const hasToken = (await this.d.repos.tokens.get()) !== null;
    const url = this.d.oauth.authorizationUrl({
      redirectUri,
      state,
      codeChallenge: await sha256Base64url(verifier),
      forceConsent: !hasToken,
    });
    return { url, stateCookie: `${state}.${verifier}` };
  }

  async finishLogin(p: {
    code: string;
    state: string;
    stateCookie: string | undefined;
    redirectUri: string;
  }): Promise<{ token: string; maxAgeSeconds: number }> {
    const [expectedState, verifier] = (p.stateCookie ?? '').split('.');
    if (!expectedState || !verifier || expectedState !== p.state) {
      throw new AppError('bad_request', 'ログインの状態が一致しません。もう一度ログインしてください');
    }
    const result = await this.d.oauth.exchangeCode({ code: p.code, codeVerifier: verifier, redirectUri: p.redirectUri });
    if (!result.emailVerified || result.email.toLowerCase() !== this.d.adminEmail.toLowerCase()) {
      throw new AppError('forbidden', 'このアカウントでは管理画面に入れません');
    }

    const now = this.d.clock.now();
    const existing = await this.d.repos.tokens.get();
    const refreshTokenEnc = result.refreshToken
      ? await this.d.secretBox.encrypt(result.refreshToken)
      : existing?.refreshTokenEnc;
    if (refreshTokenEnc) {
      await this.d.repos.tokens.save({
        refreshTokenEnc,
        accessTokenEnc: await this.d.secretBox.encrypt(result.accessToken),
        accessExpiresAt: now + result.expiresIn * 1000,
        scope: result.refreshToken ? result.scope : (existing?.scope ?? result.scope),
        updatedAt: now,
      });
    }

    const token = this.d.random.token();
    await this.d.repos.adminSessions.create({
      tokenHash: await sha256Base64url(token),
      email: result.email,
      createdAt: now,
      expiresAt: now + ADMIN_SESSION_TTL_MS,
    });
    return { token, maxAgeSeconds: ADMIN_SESSION_TTL_MS / 1000 };
  }

  async authenticate(token: string): Promise<{ email: string } | null> {
    const s = await this.d.repos.adminSessions.find(await sha256Base64url(token));
    if (!s || s.expiresAt <= this.d.clock.now()) return null;
    // 許可するメールアドレスを変えたら、古いセッションも使えなくする
    if (s.email.toLowerCase() !== this.d.adminEmail.toLowerCase()) return null;
    return { email: s.email };
  }

  async logout(token: string): Promise<void> {
    await this.d.repos.adminSessions.delete(await sha256Base64url(token));
  }

  /** カレンダーを読む権限付きのリフレッシュトークンを持っているか */
  async calendarConnected(): Promise<boolean> {
    const t = await this.d.repos.tokens.get();
    return t !== null && t.scope.split(' ').includes(this.d.oauth.calendarScope);
  }
}
