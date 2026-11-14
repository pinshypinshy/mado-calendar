// 閲覧者に見せる予定を作る（要件 4.3、5章）。閲覧画面と管理画面のプレビューの両方がこれを使う（要件 3.8）。

import type { EventsResponse, ViewerEvent, ViewerMe, WeekStart } from '../../shared/api';
import { type DateStr, jstDateOf, jstMidnight } from '../../shared/time';
import { labelKeyOf } from '../domain/event';
import { buildPolicy, resolveLevel } from '../domain/level';
import { allowedDateBounds, boundsToWindow, clampRange } from '../domain/period';
import { presentForViewer } from '../domain/present';
import { AppError } from '../errors';
import type { Clock, Repositories, ViewerRecord } from '../ports';
import type { CalendarData } from './calendarData';

/** 更新ボタンの間隔制限（要件 6章） */
export const FORCE_REFRESH_INTERVAL_MS = 30 * 1000;
/** 1回に取得できる期間の上限。月表示（最大6週）が収まる長さにする */
export const MAX_RANGE_DAYS = 62;

export interface FeedDeps {
  repos: Pick<Repositories, 'viewers' | 'rules' | 'overrides'>;
  data: CalendarData;
  clock: Clock;
}

export class FeedService {
  constructor(private readonly d: FeedDeps) {}

  me(viewer: ViewerRecord): ViewerMe {
    return {
      displayName: viewer.displayName,
      weekStart: viewer.weekStart ?? viewer.defaultWeekStart,
      bounds: allowedDateBounds(viewer.period, jstDateOf(this.d.clock.now())),
    };
  }

  async meFor(viewerId: string): Promise<ViewerMe> {
    const viewer = await this.d.repos.viewers.get(viewerId);
    if (!viewer) throw new AppError('not_found', '閲覧者が見つかりません');
    return this.me(viewer);
  }

  async setWeekStart(viewer: ViewerRecord, weekStart: WeekStart): Promise<void> {
    await this.d.repos.viewers.update(viewer.id, { weekStart });
  }

  /**
   * @param opts.forceRefresh 更新ボタン。キャッシュを使わずに Google から取り直す
   * @param opts.throttle 更新ボタンに間隔制限をかけるか（管理画面のプレビューではかけない）
   */
  async events(
    viewerId: string,
    from: DateStr,
    to: DateStr,
    opts: { forceRefresh?: boolean; throttle?: boolean } = {},
  ): Promise<EventsResponse> {
    const viewer = await this.d.repos.viewers.get(viewerId);
    if (!viewer) throw new AppError('not_found', '閲覧者が見つかりません');
    const now = this.d.clock.now();

    const window = boundsToWindow(allowedDateBounds(viewer.period, jstDateOf(now)));
    const range = clampRange({ from: jstMidnight(from), to: jstMidnight(to) }, window);
    if (!range) return { events: [], refreshRetryAfter: null };

    let force = false;
    let refreshRetryAfter: number | null = null;
    if (opts.forceRefresh) {
      const last = viewer.lastForcedRefreshAt;
      if (opts.throttle !== false && last !== null && now - last < FORCE_REFRESH_INTERVAL_MS) {
        refreshRetryAfter = Math.ceil((FORCE_REFRESH_INTERVAL_MS - (now - last)) / 1000);
      } else {
        force = true;
        if (opts.throttle !== false) await this.d.repos.viewers.update(viewer.id, { lastForcedRefreshAt: now });
      }
    }

    const calendars = await this.d.data.selectedCalendars();
    const [directory, events, rules, overrides] = await Promise.all([
      this.d.data.labelDirectory(calendars),
      this.d.data.events(
        calendars.map((c) => c.id),
        range.from,
        range.to,
        { force },
      ),
      this.d.repos.rules.listForViewer(viewer.id),
      this.d.repos.overrides.listForViewer(viewer.id),
    ]);

    const policy = buildPolicy(window, rules, overrides);
    const result: ViewerEvent[] = [];
    for (const e of events) {
      const level = resolveLevel(e, policy);
      if (level === 'hidden') continue;
      const v = presentForViewer(e, level, directory.describe(e.calendarId, labelKeyOf(e)), `e${result.length}`);
      if (v) result.push(v);
    }
    return { events: result, refreshRetryAfter };
  }
}

export function validateRange(from: string, to: string, isDate: (s: string) => boolean): void {
  if (!isDate(from) || !isDate(to)) throw new AppError('bad_request', 'from と to は YYYY-MM-DD で指定してください');
  const days = (jstMidnight(to) - jstMidnight(from)) / (24 * 60 * 60 * 1000);
  if (days <= 0 || days > MAX_RANGE_DAYS) {
    throw new AppError('bad_request', `期間は1〜${MAX_RANGE_DAYS}日で指定してください`);
  }
}
