import { describe, expect, test } from 'vitest';
import { allowedDateBounds, boundsToWindow, clampRange, overlapsWindow, validatePeriod } from './period';

describe('allowedDateBounds', () => {
  test('制限なし', () => {
    expect(allowedDateBounds({ enabled: false, pastMonths: 1, futureMonths: 1 }, '2026-11-15')).toEqual({
      min: null,
      max: null,
    });
  });
  test('過去1か月、未来3か月（未来は最終日を含む）', () => {
    expect(allowedDateBounds({ enabled: true, pastMonths: 1, futureMonths: 3 }, '2026-11-15')).toEqual({
      min: '2026-10-15',
      max: '2027-02-16',
    });
  });
  test('過去は制限なし、未来は3か月', () => {
    expect(allowedDateBounds({ enabled: true, pastMonths: null, futureMonths: 3 }, '2026-11-15')).toEqual({
      min: null,
      max: '2027-02-16',
    });
  });
});

describe('overlapsWindow / clampRange', () => {
  const w = boundsToWindow({ min: '2026-11-01', max: '2026-12-01' });
  test('重なりの判定', () => {
    const t = (s: string) => Date.parse(s);
    expect(overlapsWindow({ start: t('2026-10-31T23:00:00+09:00'), end: t('2026-11-01T01:00:00+09:00') }, w)).toBe(true);
    expect(overlapsWindow({ start: t('2026-10-31T23:00:00+09:00'), end: t('2026-11-01T00:00:00+09:00') }, w)).toBe(false);
    expect(overlapsWindow({ start: t('2026-12-01T00:00:00+09:00'), end: t('2026-12-01T01:00:00+09:00') }, w)).toBe(false);
  });
  test('範囲を切り詰める', () => {
    const from = Date.parse('2026-10-25T00:00:00+09:00');
    const to = Date.parse('2026-11-08T00:00:00+09:00');
    expect(clampRange({ from, to }, w)).toEqual({ from: w.start, to });
    expect(clampRange({ from, to: w.start! }, w)).toBeNull();
  });
});

test('validatePeriod', () => {
  expect(validatePeriod({ enabled: true, pastMonths: -1, futureMonths: null })).not.toBeNull();
  expect(validatePeriod({ enabled: true, pastMonths: 1.5, futureMonths: null })).not.toBeNull();
  expect(validatePeriod({ enabled: true, pastMonths: 0, futureMonths: 3 })).toBeNull();
});
