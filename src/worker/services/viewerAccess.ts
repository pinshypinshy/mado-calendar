// 閲覧者の参加とセッション（要件 4.1、4.6、7.2、7.3）。
// 閲覧者 ID は全オーナーの閲覧者から探す。1台の端末で、複数のオーナーの閲覧者として参加できる。

import { normalizeViewerCode } from '../domain/viewerCode';
import { AppError } from '../errors';
import { sha256Base64url } from '../lib/encoding';
import type { Clock, GlobalRepositories, OwnerRepositories, Random, SecretBox, ViewerRecord } from '../ports';
import { ownerLabel } from './ownerProfile';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cookie の有効期限。ブラウザが受け付ける上限の400日にする */
export const VIEWER_SESSION_TTL_MS = 400 * DAY_MS;
/** この間隔でセッションの期限を延長し、Cookie を発行し直す（毎回書き込まないため） */
export const VIEWER_SESSION_RENEW_INTERVAL_MS = DAY_MS;
/** 総当たり対策：この時間内に */
export const JOIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/** この回数失敗したら一時的にブロックする */
export const JOIN_FAILURE_LIMIT = 10;
/** 1台の端末で参加できる閲覧者 ID の数（Cookie の大きさを抑えるため） */
export const MAX_MEMBERSHIPS = 10;

export interface ViewerAccessDeps {
  global: Pick<GlobalRepositories, 'owners' | 'viewerDirectory' | 'viewerSessions' | 'joinFailures'>;
  forOwner: (ownerId: string) => Pick<OwnerRepositories, 'viewers'>;
  secretBox: SecretBox;
  random: Random;
  clock: Clock;
}

/** 端末が参加している閲覧者 ID 1つ分 */
export interface Membership {
  /** Cookie に入れるセッションのトークン */
  token: string;
  viewer: ViewerRecord;
  ownerName: string;
  renewed: boolean;
}

export class ViewerAccessService {
  constructor(private readonly d: ViewerAccessDeps) {}

  async join(code: string, ip: string): Promise<{ token: string; viewer: ViewerRecord }> {
    const now = this.d.clock.now();
    const failures = await this.d.global.joinFailures.countSince(ip, now - JOIN_FAILURE_WINDOW_MS);
    if (failures >= JOIN_FAILURE_LIMIT) {
      throw new AppError(
        'too_many_requests',
        '入力の失敗が多すぎます。しばらく待ってからやり直してください',
        Math.ceil(JOIN_FAILURE_WINDOW_MS / 1000),
      );
    }

    const normalized = normalizeViewerCode(code);
    const viewer = normalized
      ? await this.d.global.viewerDirectory.findByCodeHash(await this.d.secretBox.hash(normalized))
      : null;
    if (!viewer || viewer.status !== 'active') {
      await this.d.global.joinFailures.record(ip, now);
      await this.d.global.joinFailures.purgeBefore(now - DAY_MS);
      throw new AppError('unauthorized', '閲覧者 ID が正しくありません');
    }

    const token = this.d.random.token();
    await this.d.global.viewerSessions.create({
      tokenHash: await sha256Base64url(token),
      viewerId: viewer.id,
      createdAt: now,
      expiresAt: now + VIEWER_SESSION_TTL_MS,
      renewedAt: now,
    });
    await this.d.forOwner(viewer.ownerId).viewers.update(viewer.id, { lastSeenAt: now });
    return { token, viewer };
  }

  /**
   * 端末の Cookie に入っているトークンを確かめ、有効な参加だけを返す。
   * 同じ閲覧者のトークンが重複していたら、先のものだけを残す。並び順（参加した順）は保つ。
   */
  async memberships(tokens: string[]): Promise<Membership[]> {
    const result: Membership[] = [];
    for (const token of tokens.slice(0, MAX_MEMBERSHIPS * 2)) {
      const m = await this.authenticate(token);
      if (m && !result.some((r) => r.viewer.id === m.viewer.id)) result.push(m);
    }
    return result.slice(0, MAX_MEMBERSHIPS);
  }

  private async authenticate(token: string): Promise<Membership | null> {
    const now = this.d.clock.now();
    const tokenHash = await sha256Base64url(token);
    const session = await this.d.global.viewerSessions.find(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const viewer = await this.d.global.viewerDirectory.get(session.viewerId);
    if (!viewer || viewer.status !== 'active') return null;
    const owner = await this.d.global.owners.get(viewer.ownerId);
    if (!owner) return null;
    let renewed = false;
    if (now - session.renewedAt >= VIEWER_SESSION_RENEW_INTERVAL_MS) {
      await this.d.global.viewerSessions.renew(tokenHash, now + VIEWER_SESSION_TTL_MS, now);
      renewed = true;
    }
    return { token, viewer, ownerName: ownerLabel(owner.displayName), renewed };
  }

  /**
   * 端末の参加を1つ外す（要件 4.6）。セッションを D1 から消すので、Cookie の写しが残っていても使えない。
   * 閲覧者 ID は有効なままなので、同じ ID でまた参加できる
   */
  async leave(token: string): Promise<void> {
    await this.d.global.viewerSessions.delete(await sha256Base64url(token));
  }

  sessionMaxAgeSeconds(): number {
    return VIEWER_SESSION_TTL_MS / 1000;
  }

  /** 最終閲覧日時を記録する（要件 3.3）。書き込みを減らすため1分に1回まで */
  async touch(viewer: ViewerRecord): Promise<void> {
    const now = this.d.clock.now();
    if (viewer.lastSeenAt === null || now - viewer.lastSeenAt >= 60 * 1000) {
      await this.d.forOwner(viewer.ownerId).viewers.update(viewer.id, { lastSeenAt: now });
    }
  }
}
