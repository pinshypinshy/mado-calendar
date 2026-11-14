// カレンダーの配置の計算。React に依存しない純粋な関数なので、単体でテストできる。

import type { DateBounds, ViewerEvent } from '../../shared/api';
import {
  addDays,
  addMonths,
  type DateStr,
  DAY_MS,
  diffDays,
  jstDateOf,
  jstMidnight,
  jstMinutesOfDay,
  splitDate,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from '../../shared/time';

export type ViewMode = 'week' | 'month';

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 表示する期間の基準日。週表示なら週の開始日、月表示なら月の1日 */
export function normalizeAnchor(view: ViewMode, date: DateStr, weekStart: WeekStart): DateStr {
  return view === 'week' ? startOfWeek(date, weekStart) : startOfMonth(date);
}

/** 取得する期間 [from, to)。月表示はグリッドに出る前後の月の日も含む */
export function fetchRange(view: ViewMode, anchor: DateStr, weekStart: WeekStart): { from: DateStr; to: DateStr } {
  if (view === 'week') return { from: anchor, to: addDays(anchor, 7) };
  const weeks = monthGrid(anchor, weekStart);
  return { from: weeks[0]![0]!, to: addDays(weeks.at(-1)![6]!, 1) };
}

/** その期間そのもの（月表示なら月の1日〜翌月1日）。移動できるかの判定に使う */
function periodRange(view: ViewMode, anchor: DateStr): { from: DateStr; to: DateStr } {
  return view === 'week' ? { from: anchor, to: addDays(anchor, 7) } : { from: anchor, to: addMonths(anchor, 1) };
}

export function shiftAnchor(view: ViewMode, anchor: DateStr, dir: -1 | 1): DateStr {
  return view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir);
}

/** 期間制限の範囲内に移動できるか（要件 3.6、4.3） */
export function canShift(view: ViewMode, anchor: DateStr, dir: -1 | 1, bounds: DateBounds): boolean {
  const r = periodRange(view, shiftAnchor(view, anchor, dir));
  if (bounds.min !== null && r.to <= bounds.min) return false;
  if (bounds.max !== null && r.from >= bounds.max) return false;
  return true;
}

/** 日付を、閲覧できる範囲 [min, max) の中に丸める */
export function clampDate(date: DateStr, bounds: DateBounds): DateStr {
  if (bounds.min !== null && date < bounds.min) return bounds.min;
  if (bounds.max !== null && date >= bounds.max) return addDays(bounds.max, -1);
  return date;
}

export function periodTitle(view: ViewMode, anchor: DateStr): string {
  const [y, m] = splitDate(anchor);
  if (view === 'month') return `${y}年${m}月`;
  const end = addDays(anchor, 6);
  const [, m2, d2] = splitDate(end);
  const [, , d1] = splitDate(anchor);
  return m === m2 ? `${y}年${m}月${d1}日〜${d2}日` : `${y}年${m}月${d1}日〜${m2}月${d2}日`;
}

/** 月表示のグリッド。週ごとの7日の配列 */
export function monthGrid(monthStart: DateStr, weekStart: WeekStart): DateStr[][] {
  const first = startOfWeek(monthStart, weekStart);
  const nextMonth = addMonths(monthStart, 1);
  const weeks: DateStr[][] = [];
  for (let d = first; d < nextMonth; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
}

/** 週表示で、上部の帯に出す予定か（終日の予定と、日をまたぐ予定） */
export function isBandEvent(e: Pick<ViewerEvent, 'allDay' | 'start' | 'end'>): boolean {
  if (e.allDay) return true;
  return jstDateOf(e.start) !== jstDateOf(Math.max(e.start, e.end - 1));
}

export function eventsOnDate<T extends Pick<ViewerEvent, 'start' | 'end'>>(events: T[], date: DateStr): T[] {
  const from = jstMidnight(date);
  const to = from + DAY_MS;
  return events.filter((e) => e.start < to && Math.max(e.end, e.start + 1) > from);
}

export interface TimedBlock<T> {
  event: T;
  /** 0:00 からの分 */
  top: number;
  height: number;
  column: number;
  columns: number;
}

/** 1日の中の時刻のある予定を、重なりに応じて横に並べる */
export function layoutDay<T extends Pick<ViewerEvent, 'start' | 'end'>>(events: T[], minHeight = 20): TimedBlock<T>[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const blocks: TimedBlock<T>[] = [];
  let cluster: TimedBlock<T>[] = [];
  let columnsEnd: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const b of cluster) b.columns = columnsEnd.length;
    cluster = [];
    columnsEnd = [];
  };

  for (const event of sorted) {
    const top = jstMinutesOfDay(event.start);
    const height = Math.max(minHeight, Math.round((event.end - event.start) / 60000));
    const bottom = top + height;
    if (top >= clusterEnd) flush();
    let column = columnsEnd.findIndex((end) => end <= top);
    if (column === -1) {
      column = columnsEnd.length;
      columnsEnd.push(bottom);
    } else {
      columnsEnd[column] = bottom;
    }
    const block = { event, top, height, column, columns: 1 };
    cluster.push(block);
    blocks.push(block);
    clusterEnd = Math.max(clusterEnd, bottom);
  }
  flush();
  return blocks;
}

export interface BandItem<T> {
  event: T;
  /** 週の何日目から（0〜6） */
  startCol: number;
  span: number;
  row: number;
}

/** 週表示の上部の帯。週の範囲で切り詰め、重ならないよう段を分ける */
export function layoutBand<T extends Pick<ViewerEvent, 'start' | 'end'>>(events: T[], weekStartDate: DateStr): BandItem<T>[] {
  const rowsEnd: number[] = [];
  const items: BandItem<T>[] = [];
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const event of sorted) {
    const first = Math.max(0, diffDays(weekStartDate, jstDateOf(event.start)));
    const last = Math.min(6, diffDays(weekStartDate, jstDateOf(Math.max(event.start, event.end - 1))));
    if (last < 0 || first > 6) continue;
    let row = rowsEnd.findIndex((end) => end < first);
    if (row === -1) {
      row = rowsEnd.length;
      rowsEnd.push(last);
    } else {
      rowsEnd[row] = last;
    }
    items.push({ event, startCol: first, span: last - first + 1, row });
  }
  return items;
}

/**
 * 週表示を開いたときに上端に来る時刻（0:00 からの分）。要件 4.3：
 * - 今日を含む週：現在時刻の2時間前。前日になる場合（0〜1時台）は 0:00
 * - 今日を含まない週：8:00
 */
export function initialScrollMinutes(weekStartDate: DateStr, now: number): number {
  const offset = diffDays(weekStartDate, jstDateOf(now));
  if (offset < 0 || offset > 6) return 8 * 60;
  return Math.max(0, jstMinutesOfDay(now) - 120);
}

export function eventLabel(e: ViewerEvent): string {
  switch (e.level) {
    case 'detail':
      return e.title;
    case 'category':
      return e.category;
    case 'busy':
      return '予定あり';
  }
}

export function formatDateJa(date: DateStr): string {
  const [, m, d] = splitDate(date);
  return `${m}月${d}日（${WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
}

/** 予定の日時の表示（例：11月17日（火） 17:00〜22:00） */
export function formatEventTime(e: Pick<ViewerEvent, 'start' | 'end' | 'allDay'>): string {
  const startDate = jstDateOf(e.start);
  const lastDate = jstDateOf(Math.max(e.start, e.end - 1));
  if (e.allDay) {
    return startDate === lastDate
      ? `${formatDateJa(startDate)} 終日`
      : `${formatDateJa(startDate)}〜${formatDateJa(lastDate)} 終日`;
  }
  const time = (ms: number) => {
    const min = jstMinutesOfDay(ms);
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  };
  // 0:00 ちょうどに終わる予定は、前の日の 24:00 に終わるものとして表示する
  const endsAtMidnight = e.end > e.start && jstMinutesOfDay(e.end) === 0;
  if (startDate === lastDate) {
    return `${formatDateJa(startDate)} ${time(e.start)}〜${endsAtMidnight ? '24:00' : time(e.end)}`;
  }
  return `${formatDateJa(startDate)} ${time(e.start)}〜${formatDateJa(jstDateOf(e.end))} ${time(e.end)}`;
}
