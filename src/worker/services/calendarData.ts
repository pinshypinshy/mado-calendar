// Google から取得したデータを、キャッシュ越しに読む（要件 6章）。
// 予定は「カレンダー × 月」の単位で5分間キャッシュする。閲覧者ごとの絞り込みはキャッシュから取り出したあとに行う。

import { addMonths, jstDateOf, jstMidnight, startOfMonth } from '../../shared/time';
import type { ColorPalette, SourceCalendar, SourceEvent, SourceLabel } from '../domain/event';
import { buildLabelCatalog, LabelDirectory, type LabelInfo } from '../domain/labels';
import { overlapsWindow } from '../domain/period';
import type { CacheRepository, CalendarSelectionRepository, CalendarSource, Clock, LabelNameRepository } from '../ports';

export const CACHE_TTL_MS = 5 * 60 * 1000;

export interface FetchOptions {
  /** キャッシュを使わずに Google から取り直す */
  force?: boolean;
}

export interface CalendarDataDeps {
  source: CalendarSource;
  cache: CacheRepository;
  selection: CalendarSelectionRepository;
  labelNames: LabelNameRepository;
  clock: Clock;
}

export class CalendarData {
  constructor(private readonly d: CalendarDataDeps) {}

  calendars(opts: FetchOptions = {}): Promise<SourceCalendar[]> {
    return this.cached('meta:calendars', () => this.d.source.listCalendars(), opts.force);
  }

  palette(opts: FetchOptions = {}): Promise<ColorPalette> {
    return this.cached('meta:palette', () => this.d.source.getColorPalette(), opts.force);
  }

  labels(calendarId: string, opts: FetchOptions = {}): Promise<SourceLabel[]> {
    return this.cached(`meta:labels:${calendarId}`, () => this.d.source.listLabels(calendarId), opts.force);
  }

  /** 対象として選んだカレンダー。選んだあとに Google 側で消えたものは除く */
  async selectedCalendars(opts: FetchOptions = {}): Promise<SourceCalendar[]> {
    const [ids, all] = await Promise.all([this.d.selection.list(), this.calendars(opts)]);
    const byId = new Map(all.map((c) => [c.id, c]));
    return ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
  }

  async labelCatalog(calendars: SourceCalendar[], opts: FetchOptions = {}): Promise<LabelInfo[]> {
    const [palette, labelLists] = await Promise.all([
      this.palette(opts),
      Promise.all(calendars.map((c) => this.labels(c.id, opts))),
    ]);
    return calendars.flatMap((c, i) => buildLabelCatalog(c, labelLists[i] ?? [], palette));
  }

  async labelDirectory(calendars: SourceCalendar[], opts: FetchOptions = {}): Promise<LabelDirectory> {
    const [catalog, names] = await Promise.all([this.labelCatalog(calendars, opts), this.d.labelNames.list()]);
    return new LabelDirectory(calendars, catalog, names);
  }

  /** [from, to) と重なる予定。force なら キャッシュを使わずに Google から取り直す */
  async events(calendarIds: string[], from: number, to: number, opts: FetchOptions = {}): Promise<SourceEvent[]> {
    const months = monthsCovering(from, to);
    const chunks = await Promise.all(
      calendarIds.flatMap((calendarId) => months.map((month) => this.monthEvents(calendarId, month, opts.force ?? false))),
    );
    const seen = new Set<string>();
    const result: SourceEvent[] = [];
    for (const e of chunks.flat()) {
      const key = `${e.calendarId}\u0000${e.id}`;
      if (seen.has(key) || !overlapsWindow(e, { start: from, end: to })) continue;
      seen.add(key);
      result.push(e);
    }
    return result.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  private monthEvents(calendarId: string, month: string, force: boolean): Promise<SourceEvent[]> {
    const from = jstMidnight(month);
    const to = jstMidnight(addMonths(month, 1));
    return this.cached(`events:${calendarId}:${month.slice(0, 7)}`, () => this.d.source.listEvents(calendarId, from, to), force);
  }

  /**
   * キャッシュが新しければそれを返し、古ければ取り直す。
   * 取り直しに失敗したときは、古いキャッシュがあればそれを返す（Google の一時的な障害で画面が空にならないように）。
   * ただし force（更新ボタン）のときは、古いデータを最新と見せないよう、失敗をそのまま返す。
   */
  private async cached<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
    const now = this.d.clock.now();
    const entry = await this.d.cache.get(key);
    if (entry && !force && now - entry.fetchedAt < CACHE_TTL_MS) return JSON.parse(entry.payload) as T;
    try {
      const value = await load();
      await this.d.cache.put(key, JSON.stringify(value), now);
      return value;
    } catch (err) {
      if (entry && !force) {
        console.warn(`cache fallback for ${key}`, err);
        return JSON.parse(entry.payload) as T;
      }
      throw err;
    }
  }
}

/** [from, to) にかかる月の初日（JST）の一覧 */
export function monthsCovering(from: number, to: number): string[] {
  const last = startOfMonth(jstDateOf(to - 1));
  const months: string[] = [];
  for (let m = startOfMonth(jstDateOf(from)); m <= last; m = addMonths(m, 1)) months.push(m);
  return months;
}
