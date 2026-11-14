import { describe, expect, test } from 'vitest';
import {
  addDays,
  addMonths,
  formatTime,
  isDateStr,
  jstDateOf,
  jstMidnight,
  jstMinutesOfDay,
  startOfMonth,
  startOfWeek,
  weekdayOf,
} from './time';

describe('JST の変換', () => {
  test('UTC 15:00 は JST の翌日 0:00', () => {
    const ms = Date.parse('2026-11-14T15:00:00Z');
    expect(jstDateOf(ms)).toBe('2026-11-15');
    expect(jstMinutesOfDay(ms)).toBe(0);
    expect(jstMidnight('2026-11-15')).toBe(ms);
  });
  test('formatTime', () => {
    expect(formatTime(Date.parse('2026-11-15T09:30:00+09:00'))).toBe('09:30');
  });
});

describe('日付の計算', () => {
  test('addMonths は月末に丸める', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
  test('addDays は月・年をまたぐ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('週の開始日', () => {
    expect(weekdayOf('2026-11-15')).toBe(0); // 日曜
    expect(startOfWeek('2026-11-18', 0)).toBe('2026-11-15');
    expect(startOfWeek('2026-11-18', 1)).toBe('2026-11-16');
    expect(startOfWeek('2026-11-15', 1)).toBe('2026-11-09');
  });
  test('startOfMonth', () => {
    expect(startOfMonth('2026-11-15')).toBe('2026-11-01');
  });
  test('isDateStr', () => {
    expect(isDateStr('2026-02-29')).toBe(false);
    expect(isDateStr('2028-02-29')).toBe(true);
    expect(isDateStr('2026-1-1')).toBe(false);
  });
});
