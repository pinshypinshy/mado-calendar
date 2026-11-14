// 閲覧者の管理（要件 3.3、3.4、3.6、3.7）。

import type {
  AdminViewerDetail,
  AdminViewerSummary,
  DisplayRule,
  Level,
  UpdateViewerRequest,
} from '../../shared/api';
import { LEVELS } from '../../shared/api';
import { NO_PERIOD_LIMIT, validatePeriod } from '../domain/period';
import { formatViewerCode, generateViewerCode } from '../domain/viewerCode';
import { AppError } from '../errors';
import { base64url } from '../lib/encoding';
import type { Clock, Random, Repositories, SecretBox, ViewerRecord } from '../ports';

export interface AdminViewerDeps {
  repos: Pick<Repositories, 'viewers' | 'rules' | 'overrides' | 'viewerSessions'>;
  secretBox: SecretBox;
  random: Random;
  clock: Clock;
}

export class AdminViewerService {
  constructor(private readonly d: AdminViewerDeps) {}

  async list(): Promise<AdminViewerSummary[]> {
    return (await this.d.repos.viewers.list()).map(toSummary);
  }

  /** @param origin 招待 URL を作るためのオリジン（例：https://mado-cal.yuki-hiraishi.com） */
  async get(id: string, origin: string): Promise<AdminViewerDetail> {
    const v = await this.require(id);
    const code = await this.d.secretBox.decrypt(v.codeEnc);
    return {
      ...toSummary(v),
      code: formatViewerCode(code),
      inviteUrl: inviteUrl(origin, code),
      defaultWeekStart: v.defaultWeekStart,
      period: v.period,
    };
  }

  async create(displayName: string, origin: string): Promise<AdminViewerDetail> {
    const name = validateName(displayName);
    const id = base64url(this.d.random.bytes(12));
    await this.d.repos.viewers.insert({
      id,
      displayName: name,
      ...(await this.newCode()),
      status: 'active',
      defaultWeekStart: 0,
      weekStart: null,
      period: NO_PERIOD_LIMIT,
      createdAt: this.d.clock.now(),
      lastSeenAt: null,
      lastForcedRefreshAt: null,
    });
    return this.get(id, origin);
  }

  async update(id: string, req: UpdateViewerRequest): Promise<void> {
    await this.require(id);
    if (req.period) {
      const error = validatePeriod(req.period);
      if (error) throw new AppError('bad_request', error);
    }
    if (req.defaultWeekStart !== undefined && req.defaultWeekStart !== 0 && req.defaultWeekStart !== 1) {
      throw new AppError('bad_request', '週の開始曜日は 0（日曜）か 1（月曜）で指定してください');
    }
    await this.d.repos.viewers.update(id, {
      ...(req.displayName !== undefined ? { displayName: validateName(req.displayName) } : {}),
      ...(req.defaultWeekStart !== undefined ? { defaultWeekStart: req.defaultWeekStart } : {}),
      ...(req.period !== undefined ? { period: req.period } : {}),
    });
  }

  /** 無効化：ID を使えなくし、参加済みの端末もすべて表示できなくする */
  async disable(id: string): Promise<void> {
    await this.require(id);
    await this.d.repos.viewers.update(id, { status: 'disabled' });
    await this.d.repos.viewerSessions.deleteForViewer(id);
  }

  /** 再発行：新しい ID を発行し、古い ID と参加済みの端末をすべて無効にする。無効化した閲覧者も再び有効になる */
  async regenerate(id: string): Promise<void> {
    await this.require(id);
    await this.d.repos.viewers.update(id, { ...(await this.newCode()), status: 'active' });
    await this.d.repos.viewerSessions.deleteForViewer(id);
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    await this.d.repos.viewers.delete(id);
  }

  /** 設定のコピー：表示ルール、個別設定、期間制限、週の開始曜日の初期値（要件 3.3） */
  async copySettings(targetId: string, sourceId: string): Promise<void> {
    if (targetId === sourceId) throw new AppError('bad_request', 'コピー元とコピー先が同じです');
    const [target, source] = await Promise.all([this.require(targetId), this.require(sourceId)]);
    const [rules, overrides] = await Promise.all([
      this.d.repos.rules.listForViewer(source.id),
      this.d.repos.overrides.listForViewer(source.id),
    ]);
    await this.d.repos.rules.replaceAll(target.id, rules);
    await this.d.repos.overrides.replaceAll(target.id, overrides);
    await this.d.repos.viewers.update(target.id, { period: source.period, defaultWeekStart: source.defaultWeekStart });
  }

  async rules(viewerId: string): Promise<DisplayRule[]> {
    await this.require(viewerId);
    return this.d.repos.rules.listForViewer(viewerId);
  }

  async setRule(viewerId: string, rule: DisplayRule): Promise<void> {
    await this.require(viewerId);
    if (!LEVELS.includes(rule.level as Level)) throw new AppError('bad_request', '表示レベルが正しくありません');
    if (!rule.calendarId || !rule.labelKey) throw new AppError('bad_request', 'calendarId と labelKey が必要です');
    await this.d.repos.rules.set(viewerId, rule.calendarId, rule.labelKey, rule.level);
  }

  private async require(id: string): Promise<ViewerRecord> {
    const v = await this.d.repos.viewers.get(id);
    if (!v) throw new AppError('not_found', '閲覧者が見つかりません');
    return v;
  }

  private async newCode(): Promise<{ codeEnc: string; codeHash: string }> {
    const code = generateViewerCode((n) => this.d.random.bytes(n));
    return { codeEnc: await this.d.secretBox.encrypt(code), codeHash: await this.d.secretBox.hash(code) };
  }
}

/**
 * 招待 URL。ID は URL のフラグメント（# 以降）に入れる。
 * フラグメントはサーバーに送られないので、アクセスログや LINE のリンクプレビューの取得で ID が漏れにくい。
 */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/join#${formatViewerCode(code)}`;
}

function toSummary(v: ViewerRecord): AdminViewerSummary {
  return {
    id: v.id,
    displayName: v.displayName,
    status: v.status,
    createdAt: v.createdAt,
    lastSeenAt: v.lastSeenAt,
  };
}

function validateName(name: string): string {
  const n = (name ?? '').trim();
  if (n.length === 0 || n.length > 50) throw new AppError('bad_request', '表示名は1〜50文字で入力してください');
  return n;
}
