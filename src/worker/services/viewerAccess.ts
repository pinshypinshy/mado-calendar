// 閲覧者の参加とセッション（要件 4.1、7.2、7.3）。

import { normalizeViewerCode } from '../domain/viewerCode';
import { AppError } from '../errors';
import { sha256Base64url } from '../lib/encoding';
import type { Clock, Random, Repositories, SecretBox, ViewerRecord } from '../ports';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cookie の有効期限。ブラウザが受け付ける上限の400日にする */
export const VIEWER_SESSION_TTL_MS = 400 * DAY_MS;
/** この間隔でセッションの期限を延長し、Cookie を発行し直す（毎回書き込まないため） */
export const VIEWER_SESSION_RENEW_INTERVAL_MS = DAY_MS;
/** 総当たり対策：この時間内に */
export const JOIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** この回数失敗したら一時的にブロックする */
export const JOIN_FAILURE_LIMIT = 10;

export interface ViewerAccessDeps {
  repos: Pick<Repositories, 'viewers' | 'viewerSessions' | 'joinFailures'>;
  secretBox: SecretBox;
  random: Random;
  clock: Clock;
}

export class ViewerAccessService {
  constructor(private readonly d: ViewerAccessDeps) {}

  async join(code: string, ip: string): Promise<{ token: string; maxAgeSeconds: number }> {
    const now = this.d.clock.now();
    const failures = await this.d.repos.joinFailures.countSince(ip, now - JOIN_FAILURE_WINDOW_MS);
    if (failures >= JOIN_FAILURE_LIMIT) {
      throw new AppError(
        'too_many_requests',
        '入力の失敗が多すぎます。しばらく待ってからやり直してください',
        Math.ceil(JOIN_FAILURE_WINDOW_MS / 1000),
      );
    }

    const normalized = normalizeViewerCode(code);
    const viewer = normalized ? await this.d.repos.viewers.findByCodeHash(await this.d.secretBox.hash(normalized)) : null;
    if (!viewer || viewer.status !== 'active') {
      await this.d.repos.joinFailures.record(ip, now);
      await this.d.repos.joinFailures.purgeBefore(now - DAY_MS);
      throw new AppError('unauthorized', '閲覧者 ID が正しくありません');
    }

    const token = this.d.random.token();
    await this.d.repos.viewerSessions.create({
      tokenHash: await sha256Base64url(token),
      viewerId: viewer.id,
      createdAt: now,
      expiresAt: now + VIEWER_SESSION_TTL_MS,
      renewedAt: now,
    });
    await this.d.repos.viewers.update(viewer.id, { lastSeenAt: now });
    return { token, maxAgeSeconds: VIEWER_SESSION_TTL_MS / 1000 };
  }

  /** Cookie のトークンから閲覧者を引く。renewed なら Cookie を発行し直す */
  async authenticate(token: string): Promise<{ viewer: ViewerRecord; renewed: boolean } | null> {
    const now = this.d.clock.now();
    const tokenHash = await sha256Base64url(token);
    const session = await this.d.repos.viewerSessions.find(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const viewer = await this.d.repos.viewers.get(session.viewerId);
    if (!viewer || viewer.status !== 'active') return null;
    let renewed = false;
    if (now - session.renewedAt >= VIEWER_SESSION_RENEW_INTERVAL_MS) {
      await this.d.repos.viewerSessions.renew(tokenHash, now + VIEWER_SESSION_TTL_MS, now);
      renewed = true;
    }
    return { viewer, renewed };
  }

  sessionMaxAgeSeconds(): number {
    return VIEWER_SESSION_TTL_MS / 1000;
  }

  /** 最終閲覧日時を記録する（要件 3.3）。書き込みを減らすため1分に1回まで */
  async touch(viewer: ViewerRecord): Promise<void> {
    const now = this.d.clock.now();
    if (viewer.lastSeenAt === null || now - viewer.lastSeenAt >= 60 * 1000) {
      await this.d.repos.viewers.update(viewer.id, { lastSeenAt: now });
    }
  }
}
