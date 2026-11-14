// 期間制限（要件 3.6）。

import type { DateBounds, PeriodLimit } from '../../shared/api';
import { addDays, addMonths, type DateStr, jstMidnight } from '../../shared/time';

export interface TimeWindow {
  /** 含む。null は制限なし */
  start: number | null;
  /** 含まない。null は制限なし */
  end: number | null;
}

export const NO_PERIOD_LIMIT: PeriodLimit = { enabled: false, pastMonths: null, futureMonths: null };

/** 閲覧できる日付の範囲。過去は today から pastMonths か月前の日、未来は futureMonths か月後の日まで（その日を含む） */
export function allowedDateBounds(period: PeriodLimit, today: DateStr): DateBounds {
  if (!period.enabled) return { min: null, max: null };
  return {
    min: period.pastMonths === null ? null : addMonths(today, -period.pastMonths),
    max: period.futureMonths === null ? null : addDays(addMonths(today, period.futureMonths), 1),
  };
}

export function boundsToWindow(bounds: DateBounds): TimeWindow {
  return {
    start: bounds.min === null ? null : jstMidnight(bounds.min),
    end: bounds.max === null ? null : jstMidnight(bounds.max),
  };
}

/** 予定が許可期間と少しでも重なるか。長さ0の予定は開始時刻で判定する */
export function overlapsWindow(e: { start: number; end: number }, w: TimeWindow): boolean {
  const end = Math.max(e.end, e.start + 1);
  if (w.start !== null && end <= w.start) return false;
  if (w.end !== null && e.start >= w.end) return false;
  return true;
}

/** 要求された範囲 [from, to) を許可期間で切り詰める。重ならなければ null */
export function clampRange(
  range: { from: number; to: number },
  w: TimeWindow,
): { from: number; to: number } | null {
  const from = w.start === null ? range.from : Math.max(range.from, w.start);
  const to = w.end === null ? range.to : Math.min(range.to, w.end);
  return from < to ? { from, to } : null;
}

export function validatePeriod(p: PeriodLimit): string | null {
  for (const v of [p.pastMonths, p.futureMonths]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 120)) {
      return '期間は0〜120か月の整数で指定してください';
    }
  }
  return null;
}
