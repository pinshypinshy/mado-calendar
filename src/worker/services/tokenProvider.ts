// オーナーのアクセストークンを返す。期限が近ければリフレッシュトークンで取り直す（要件 7.4）。

import { AppError, OAuthRevokedError } from '../errors';
import type { Clock, OAuthProvider, SecretBox, TokenRepository } from '../ports';

/** 期限のこの時間前になったら取り直す */
const REFRESH_MARGIN_MS = 60 * 1000;

export class TokenProvider {
  constructor(
    private readonly d: { tokens: TokenRepository; oauth: OAuthProvider; secretBox: SecretBox; clock: Clock },
  ) {}

  async accessToken(): Promise<string> {
    const t = await this.d.tokens.get();
    if (!t) throw notConnected();
    const now = this.d.clock.now();
    if (t.accessTokenEnc && t.accessExpiresAt !== null && t.accessExpiresAt - REFRESH_MARGIN_MS > now) {
      return this.d.secretBox.decrypt(t.accessTokenEnc);
    }
    const refreshToken = await this.d.secretBox.decrypt(t.refreshTokenEnc);
    try {
      const fresh = await this.d.oauth.refresh(refreshToken);
      await this.d.tokens.save({
        ...t,
        accessTokenEnc: await this.d.secretBox.encrypt(fresh.accessToken),
        accessExpiresAt: now + fresh.expiresIn * 1000,
        updatedAt: now,
      });
      return fresh.accessToken;
    } catch (err) {
      if (err instanceof OAuthRevokedError) throw notConnected();
      throw err;
    }
  }
}

function notConnected(): AppError {
  return new AppError(
    'calendar_not_connected',
    'Google カレンダーと連携していないか、連携が切れています。管理画面からログインし直してください',
  );
}
