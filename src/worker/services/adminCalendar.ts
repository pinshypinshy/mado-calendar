// カレンダー・ラベル・予定の管理（要件 3.2、3.4、3.5）。

import type {
  AdminCalendar,
  AdminEvent,
  AdminEventsResponse,
  AdminLabel,
  AdminViewerLabel,
  OverrideLevel,
  RenameLabelRequest,
  SetOverrideRequest,
} from '../../shared/api';
import { OVERRIDE_LEVELS } from '../../shared/api';
import { type DateStr, jstDateOf, jstMidnight } from '../../shared/time';
import { labelKeyOf, seriesKeyOf } from '../domain/event';
import { categoryNameOf } from '../domain/labels';
import { buildPolicy, type OverrideRow, resolveLevel, type RuleRow } from '../domain/level';
import { allowedDateBounds, boundsToWindow } from '../domain/period';
import { AppError } from '../errors';
import type { Clock, Repositories } from '../ports';
import type { CalendarData } from './calendarData';

export interface AdminCalendarDeps {
  repos: Pick<
    Repositories,
    'viewers' | 'rules' | 'overrides' | 'calendarSelection' | 'labelNames' | 'viewerLabelNames' | 'cache'
  >;
  data: CalendarData;
  clock: Clock;
}

export class AdminCalendarService {
  constructor(private readonly d: AdminCalendarDeps) {}

  async calendars(): Promise<AdminCalendar[]> {
    const [all, selected] = await Promise.all([this.d.data.calendars(), this.d.repos.calendarSelection.list()]);
    const selectedSet = new Set(selected);
    return all.map((c) => ({ ...c, selected: selectedSet.has(c.id) }));
  }

  async selectCalendars(calendarIds: string[]): Promise<void> {
    const all = new Set((await this.d.data.calendars()).map((c) => c.id));
    for (const id of calendarIds) {
      if (!all.has(id)) throw new AppError('bad_request', `カレンダーが見つかりません：${id}`);
    }
    await this.d.repos.calendarSelection.replace([...new Set(calendarIds)]);
  }

  async labels(): Promise<AdminLabel[]> {
    const calendars = await this.d.data.selectedCalendars();
    const [catalog, names] = await Promise.all([this.d.data.labelCatalog(calendars), this.d.repos.labelNames.list()]);
    const nameMap = new Map(names.map((n) => [`${n.calendarId}\u0000${n.labelKey}`, n.displayName]));
    const calendarName = new Map(calendars.map((c) => [c.id, c.name]));
    return catalog.map((l) => {
      const displayName = nameMap.get(`${l.calendarId}\u0000${l.labelKey}`) ?? null;
      return {
        calendarId: l.calendarId,
        labelKey: l.labelKey,
        kind: l.kind,
        sourceName: l.sourceName,
        displayName,
        categoryName: categoryNameOf({
          globalName: displayName,
          sourceName: l.sourceName,
          calendarName: calendarName.get(l.calendarId) ?? '',
        }),
        color: l.color,
      };
    });
  }

  async renameLabel(req: RenameLabelRequest): Promise<void> {
    await this.d.repos.labelNames.set(req.calendarId, req.labelKey, normalizeDisplayName(req.displayName));
  }

  /** 閲覧者1人から見たラベルの一覧。閲覧者ごとの上書きと、その閲覧者に見せるカテゴリ名を付ける */
  async viewerLabels(viewerId: string): Promise<AdminViewerLabel[]> {
    await this.requireViewer(viewerId);
    const calendars = await this.d.data.selectedCalendars();
    const [labels, names, directory] = await Promise.all([
      this.labels(),
      this.d.repos.viewerLabelNames.listForViewer(viewerId),
      this.d.data.labelDirectory(calendars),
    ]);
    // 閲覧画面と同じ LabelDirectory で決めることで、管理画面の表示と閲覧者に見える名前を食い違わせない
    const forViewer = directory.withViewerNames(names);
    const nameMap = new Map(names.map((n) => [`${n.calendarId}\u0000${n.labelKey}`, n.displayName]));
    return labels.map((l) => ({
      ...l,
      viewerDisplayName: nameMap.get(`${l.calendarId}\u0000${l.labelKey}`) ?? null,
      viewerCategoryName: forViewer.describe(l.calendarId, l.labelKey).categoryName,
    }));
  }

  async renameLabelForViewer(viewerId: string, req: RenameLabelRequest): Promise<void> {
    await this.requireViewer(viewerId);
    await this.d.repos.viewerLabelNames.set(viewerId, req.calendarId, req.labelKey, normalizeDisplayName(req.displayName));
  }

  private async requireViewer(viewerId: string): Promise<void> {
    if (!(await this.d.repos.viewers.get(viewerId))) throw new AppError('not_found', '閲覧者が見つかりません');
  }

  /** 管理画面の予定一覧。閲覧者ごとの個別設定と、実際の表示レベルを付ける */
  async events(from: DateStr, to: DateStr): Promise<AdminEventsResponse> {
    const calendars = await this.d.data.selectedCalendars();
    const [directory, events, viewers, rules, overrides] = await Promise.all([
      this.d.data.labelDirectory(calendars),
      this.d.data.events(
        calendars.map((c) => c.id),
        jstMidnight(from),
        jstMidnight(to),
      ),
      this.d.repos.viewers.list(),
      this.d.repos.rules.listAll(),
      this.d.repos.overrides.listAll(),
    ]);
    const today = jstDateOf(this.d.clock.now());
    const perViewer = viewers.map((v) => {
      const myRules: RuleRow[] = rules.filter((r) => r.viewerId === v.id);
      const myOverrides: OverrideRow[] = overrides.filter((o) => o.viewerId === v.id);
      const lookup = new Map(myOverrides.map((o) => [`${o.calendarId}\u0000${o.eventKey}`, o.level]));
      return {
        viewer: v,
        policy: buildPolicy(boundsToWindow(allowedDateBounds(v.period, today)), myRules, myOverrides),
        override: (calendarId: string, key: string): OverrideLevel | null => lookup.get(`${calendarId}\u0000${key}`) ?? null,
      };
    });

    const result: AdminEvent[] = events.map((e) => {
      const labelKey = labelKeyOf(e);
      const look = directory.describe(e.calendarId, labelKey);
      return {
        calendarId: e.calendarId,
        calendarName: directory.calendarName(e.calendarId),
        eventId: e.id,
        recurringEventId: e.recurringEventId,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        labelKey,
        categoryName: look.categoryName,
        color: look.color,
        viewers: perViewer.map((p) => ({
          viewerId: p.viewer.id,
          instanceLevel: e.recurringEventId ? p.override(e.calendarId, e.id) : null,
          seriesLevel: p.override(e.calendarId, seriesKeyOf(e)),
          effective: resolveLevel(e, p.policy),
        })),
      };
    });
    return {
      events: result,
      viewers: viewers.map((v) => ({
        id: v.id,
        displayName: v.displayName,
        status: v.status,
        createdAt: v.createdAt,
        lastSeenAt: v.lastSeenAt,
      })),
    };
  }

  async setOverride(req: SetOverrideRequest): Promise<void> {
    if (req.level !== null && !OVERRIDE_LEVELS.includes(req.level)) {
      throw new AppError('bad_request', '表示レベルが正しくありません');
    }
    if (!req.calendarId || !req.eventKey) throw new AppError('bad_request', 'calendarId と eventKey が必要です');
    const viewer = await this.d.repos.viewers.get(req.viewerId);
    if (!viewer) throw new AppError('not_found', '閲覧者が見つかりません');
    await this.d.repos.overrides.set(req.viewerId, req.calendarId, req.eventKey, req.level);
  }

  /** キャッシュを捨てる。次の表示で Google から取り直す */
  async clearCache(): Promise<void> {
    await this.d.repos.cache.deleteAll();
  }
}

/** 表示名の上書きの入力を整える。空欄なら null（上書きを消す） */
function normalizeDisplayName(displayName: string | null): string | null {
  const name = displayName === null ? null : displayName.trim();
  if (name !== null && name.length > 50) throw new AppError('bad_request', '表示名は50文字以内で入力してください');
  return name === '' ? null : name;
}
