// オーナー（と運営者）の管理画面へのログイン（要件 3.1、3.10、7.4）。
// Google の OAuth を自前で実装し、ログインと同時に、そのオーナーのカレンダーを読むためのリフレッシュトークンを受け取る。

import { AppError } from '../errors';
import { base64url, sha256Base64url } from '../lib/encoding';
import type {
  Clock,
  GlobalRepositories,
  OAuthProvider,
  OwnerRecord,
  OwnerRepositories,
  Random,
  SecretBox,
} from '../ports';

export const OWNER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface OwnerAuthDeps {
  global: Pick<GlobalRepositories, 'owners' | 'ownerSessions'>;
  forOwner: (ownerId: string) => Pick<OwnerRepositories, 'tokens'>;
  oauth: OAuthProvider;
  secretBox: SecretBox;
  random: Random;
  clock: Clock;
  /** 運営者のメールアドレス（Secret の OPERATOR_EMAIL） */
  operatorEmail: string;
}

export type FinishLoginResult =
  | { kind: 'ok'; token: string; maxAgeSeconds: number }
  /** リフレッシュトークンを持っておらず、Google も返さなかった。同意画面を出してログインし直す */
  | { kind: 'needs_consent' };

export class OwnerAuthService {
  constructor(private readonly d: OwnerAuthDeps) {}

  /** @returns Google の認可画面の URL と、Cookie に入れる値（state と PKCE の verifier） */
  async startLogin(
    redirectUri: string,
    opts: { loginHint: string | null; forceConsent: boolean },
  ): Promise<{ url: string; stateCookie: string }> {
    const state = this.d.random.token();
    const verifier = this.d.random.token();
    const url = this.d.oauth.authorizationUrl({
      redirectUri,
      state,
      codeChallenge: await sha256Base64url(verifier),
      forceConsent: opts.forceConsent,
      loginHint: opts.loginHint,
    });
    return { url, stateCookie: `${state}.${verifier}` };
  }

  async finishLogin(p: {
    code: string;
    state: string;
    stateCookie: string | undefined;
    redirectUri: string;
  }): Promise<FinishLoginResult> {
    const [expectedState, verifier] = (p.stateCookie ?? '').split('.');
    if (!expectedState || !verifier || expectedState !== p.state) {
      throw new AppError('bad_request', 'ログインの状態が一致しません。もう一度ログインしてください');
    }
    const result = await this.d.oauth.exchangeCode({ code: p.code, codeVerifier: verifier, redirectUri: p.redirectUri });
    if (!result.emailVerified) throw new AppError('forbidden', 'メールアドレスが確認されていないアカウントでは入れません');

    const owner = await this.ownerForLogin(result.email.toLowerCase());
    const now = this.d.clock.now();
    const tokens = this.d.forOwner(owner.id).tokens;
    const existing = await tokens.get();
    if (!result.refreshToken && !existing) return { kind: 'needs_consent' };
    await tokens.save({
      refreshTokenEnc: result.refreshToken
        ? await this.d.secretBox.encrypt(result.refreshToken)
        : existing!.refreshTokenEnc,
      accessTokenEnc: await this.d.secretBox.encrypt(result.accessToken),
      accessExpiresAt: now + result.expiresIn * 1000,
      scope: result.refreshToken ? result.scope : (existing?.scope ?? result.scope),
      updatedAt: now,
    });
    await this.d.global.owners.touchLogin(owner.id, now);

    const token = this.d.random.token();
    await this.d.global.ownerSessions.create({
      tokenHash: await sha256Base64url(token),
      ownerId: owner.id,
      createdAt: now,
      expiresAt: now + OWNER_SESSION_TTL_MS,
    });
    return { kind: 'ok', token, maxAgeSeconds: OWNER_SESSION_TTL_MS / 1000 };
  }

  /**
   * ログインしてきたアカウントのオーナーを返す。
   * 運営者は、まだ登録されていなければここでオーナーとして登録する。それ以外は、運営者が追加したアドレスだけが入れる。
   */
  private async ownerForLogin(email: string): Promise<OwnerRecord> {
    const owner = await this.d.global.owners.findByEmail(email);
    if (owner) return owner;
    if (email !== this.d.operatorEmail.toLowerCase()) {
      throw new AppError('forbidden', 'このアカウントはオーナーとして登録されていません。運営者に追加を頼んでください');
    }
    const created: OwnerRecord = {
      id: base64url(this.d.random.bytes(12)),
      email,
      displayName: '',
      createdAt: this.d.clock.now(),
      lastLoginAt: null,
    };
    await this.d.global.owners.insert(created);
    return created;
  }

  async authenticate(token: string): Promise<{ owner: OwnerRecord; isOperator: boolean } | null> {
    const s = await this.d.global.ownerSessions.find(await sha256Base64url(token));
    if (!s || s.expiresAt <= this.d.clock.now()) return null;
    // 削除されたオーナーのセッションは使えない
    const owner = await this.d.global.owners.get(s.ownerId);
    if (!owner) return null;
    return { owner, isOperator: owner.email === this.d.operatorEmail.toLowerCase() };
  }

  async logout(token: string): Promise<void> {
    await this.d.global.ownerSessions.delete(await sha256Base64url(token));
  }

  /** そのオーナーが、カレンダーを読む権限付きのリフレッシュトークンを持っているか */
  async calendarConnected(ownerId: string): Promise<boolean> {
    const t = await this.d.forOwner(ownerId).tokens.get();
    return t !== null && t.scope.split(' ').includes(this.d.oauth.calendarScope);
  }
}
