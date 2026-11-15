import { describe, expect, test } from 'vitest';
import {
  canShift,
  clampDate,
  formatEventTime,
  fetchRange,
  initialScrollMinutes,
  isBandEvent,
  layoutBand,
  layoutDay,
  monthGrid,
  normalizeAnchor,
  periodTitle,
  switchAnchor,
  threeWeeksGrid,
} from './layout';

const t = (s: string) => Date.parse(s);

describe('期間', () => {
  test('週表示：週の開始曜日で基準日が変わる', () => {
    expect(normalizeAnchor('week', '2026-11-18', 0)).toBe('2026-11-15');
    expect(normalizeAnchor('week', '2026-11-18', 1)).toBe('2026-11-16');
    expect(fetchRange('week', '2026-11-15', 0)).toEqual({ from: '2026-11-15', to: '2026-11-22' });
  });
  test('月表示：前後の月の日も含めたグリッド', () => {
    const weeks = monthGrid('2026-11-01', 0);
    expect(weeks[0]![0]).toBe('2026-11-01');
    expect(weeks.at(-1)![6]).toBe('2026-12-05');
    expect(fetchRange('month', '2026-11-01', 1)).toEqual({ from: '2026-10-26', to: '2026-12-07' });
  });
  test('3週間表示：週の開始日から3週間', () => {
    expect(normalizeAnchor('threeWeeks', '2026-11-18', 0)).toBe('2026-11-15');
    expect(normalizeAnchor('threeWeeks', '2026-11-18', 1)).toBe('2026-11-16');
    expect(fetchRange('threeWeeks', '2026-11-15', 0)).toEqual({ from: '2026-11-15', to: '2026-12-06' });
    const weeks = threeWeeksGrid('2026-11-29');
    expect(weeks.map((w) => [w[0], w[6]])).toEqual([
      ['2026-11-29', '2026-12-05'],
      ['2026-12-06', '2026-12-12'],
      ['2026-12-13', '2026-12-19'],
    ]);
  });
  test('タイトル', () => {
    expect(periodTitle('month', '2026-11-01')).toBe('2026年11月');
    expect(periodTitle('week', '2026-11-15')).toBe('2026年11月15日〜21日');
    expect(periodTitle('week', '2026-11-29')).toBe('2026年11月29日〜12月5日');
    expect(periodTitle('threeWeeks', '2026-11-01')).toBe('2026年11月1日〜21日');
    expect(periodTitle('threeWeeks', '2026-11-15')).toBe('2026年11月15日〜12月5日');
  });
});

describe('期間制限の範囲外へは移動できない', () => {
  const bounds = { min: '2026-10-16', max: '2026-11-22' };
  test('週表示', () => {
    expect(canShift('week', '2026-11-15', 1, bounds)).toBe(false);
    expect(canShift('week', '2026-11-08', 1, bounds)).toBe(true);
    expect(canShift('week', '2026-10-18', -1, bounds)).toBe(true); // 10/11〜17 は 10/16 を含む
    expect(canShift('week', '2026-10-11', -1, bounds)).toBe(false);
  });
  test('月表示', () => {
    expect(canShift('month', '2026-11-01', 1, bounds)).toBe(false);
    expect(canShift('month', '2026-11-01', -1, bounds)).toBe(true);
    expect(canShift('month', '2026-10-01', -1, bounds)).toBe(false);
  });
  test('3週間表示：3週間ずつ動く', () => {
    expect(canShift('threeWeeks', '2026-11-01', 1, bounds)).toBe(false); // 11/22〜12/12 は max（11/22）以降なので移れない
    expect(canShift('threeWeeks', '2026-10-25', 1, bounds)).toBe(true); // 11/15〜12/5 は 11/21 までを含む
    expect(canShift('threeWeeks', '2026-10-18', -1, bounds)).toBe(true); // 9/27〜10/17 は 10/16 を含む
    expect(canShift('threeWeeks', '2026-10-11', -1, bounds)).toBe(false); // 9/20〜10/10
  });
  test('制限なし', () => {
    expect(canShift('week', '2026-11-15', 1, { min: null, max: null })).toBe(true);
  });
});

describe('表示を切り替えたときの期間', () => {
  const none = { min: null, max: null };
  const today = '2026-11-18';
  test('今日を含む期間からは、今日を含む期間へ', () => {
    // 3週間表示（11/8〜28）から週表示へ：最初の週ではなく、今日を含む週
    expect(switchAnchor('threeWeeks', 'week', '2026-11-08', today, 0, none)).toBe('2026-11-15');
    expect(switchAnchor('threeWeeks', 'month', '2026-11-15', today, 0, none)).toBe('2026-11-01');
    expect(switchAnchor('month', 'threeWeeks', '2026-11-01', today, 0, none)).toBe('2026-11-15');
    expect(switchAnchor('week', 'threeWeeks', '2026-11-15', today, 0, none)).toBe('2026-11-15');
  });
  test('今日を含まない期間：月表示へは最初の週の真ん中の日の月、ほかは最初の日の週から', () => {
    expect(switchAnchor('threeWeeks', 'month', '2026-11-29', today, 0, none)).toBe('2026-12-01');
    expect(switchAnchor('week', 'month', '2026-11-29', today, 0, none)).toBe('2026-12-01');
    expect(switchAnchor('threeWeeks', 'week', '2026-12-06', today, 0, none)).toBe('2026-12-06');
    expect(switchAnchor('month', 'threeWeeks', '2027-01-01', today, 0, none)).toBe('2026-12-27');
    expect(switchAnchor('month', 'week', '2027-01-01', today, 1, none)).toBe('2026-12-28');
  });
  test('期間制限の外に移らない', () => {
    // 月表示（10月）から週表示へ：10/1 ではなく、閲覧できる最初の日 10/16 の週
    expect(switchAnchor('month', 'threeWeeks', '2026-10-01', today, 0, { min: '2026-10-16', max: null })).toBe('2026-10-11');
  });
});

test('clampDate', () => {
  const bounds = { min: '2026-10-15', max: '2026-12-16' };
  expect(clampDate('2026-10-01', bounds)).toBe('2026-10-15');
  expect(clampDate('2026-12-16', bounds)).toBe('2026-12-15');
  expect(clampDate('2026-11-01', bounds)).toBe('2026-11-01');
  expect(clampDate('2026-01-01', { min: null, max: null })).toBe('2026-01-01');
});

describe('週表示の開始時刻（要件 4.3）', () => {
  test('今日を含む週は現在時刻の2時間前', () => {
    expect(initialScrollMinutes('2026-11-15', t('2026-11-16T10:30:00+09:00'))).toBe(8 * 60 + 30);
  });
  test('0〜1時台は 0:00', () => {
    expect(initialScrollMinutes('2026-11-15', t('2026-11-16T01:30:00+09:00'))).toBe(0);
  });
  test('今日を含まない週は 8:00', () => {
    expect(initialScrollMinutes('2026-11-22', t('2026-11-16T10:30:00+09:00'))).toBe(8 * 60);
  });
});

describe('帯に出す予定', () => {
  test('終日と、日をまたぐ予定', () => {
    expect(isBandEvent({ allDay: true, start: 0, end: 1 })).toBe(true);
    expect(isBandEvent({ allDay: false, start: t('2026-11-20T22:00:00+09:00'), end: t('2026-11-21T01:00:00+09:00') })).toBe(true);
    expect(isBandEvent({ allDay: false, start: t('2026-11-20T22:00:00+09:00'), end: t('2026-11-21T00:00:00+09:00') })).toBe(false);
  });
  test('帯の段組み：重なる予定は別の段、週の外は切り詰める', () => {
    const a = { start: t('2026-11-14T00:00:00+09:00'), end: t('2026-11-17T00:00:00+09:00') }; // 土〜月
    const b = { start: t('2026-11-16T00:00:00+09:00'), end: t('2026-11-17T00:00:00+09:00') }; // 月
    const c = { start: t('2026-11-18T00:00:00+09:00'), end: t('2026-11-19T00:00:00+09:00') }; // 水
    const items = layoutBand([a, b, c], '2026-11-15');
    expect(items.map((i) => [i.startCol, i.span, i.row])).toEqual([
      [0, 2, 0],
      [1, 1, 1],
      [3, 1, 0],
    ]);
  });
});

describe('1日の予定の重なり', () => {
  test('重なる予定は横に並べ、重ならない予定は全幅', () => {
    const lunch = { start: t('2026-11-18T12:00:00+09:00'), end: t('2026-11-18T13:00:00+09:00') };
    const prep = { start: t('2026-11-18T12:30:00+09:00'), end: t('2026-11-18T14:00:00+09:00') };
    const later = { start: t('2026-11-18T15:00:00+09:00'), end: t('2026-11-18T16:00:00+09:00') };
    const blocks = layoutDay([later, prep, lunch]);
    expect(blocks.map((b) => [b.top, b.height, b.column, b.columns])).toEqual([
      [720, 60, 0, 2],
      [750, 90, 1, 2],
      [900, 60, 0, 1],
    ]);
  });
});

describe('formatEventTime', () => {
  test('時刻のある予定', () => {
    expect(formatEventTime({ allDay: false, start: t('2026-11-17T17:00:00+09:00'), end: t('2026-11-17T22:00:00+09:00') })).toBe(
      '11月17日（火） 17:00〜22:00',
    );
  });
  test('24:00 に終わる予定', () => {
    expect(formatEventTime({ allDay: false, start: t('2026-11-17T22:00:00+09:00'), end: t('2026-11-18T00:00:00+09:00') })).toBe(
      '11月17日（火） 22:00〜24:00',
    );
  });
  test('日をまたぐ予定', () => {
    expect(formatEventTime({ allDay: false, start: t('2026-11-20T22:00:00+09:00'), end: t('2026-11-21T01:00:00+09:00') })).toBe(
      '11月20日（金） 22:00〜11月21日（土） 01:00',
    );
  });
  test('終日・複数日', () => {
    expect(formatEventTime({ allDay: true, start: t('2026-11-24T00:00:00+09:00'), end: t('2026-11-25T00:00:00+09:00') })).toBe(
      '11月24日（火） 終日',
    );
    expect(formatEventTime({ allDay: true, start: t('2026-11-24T00:00:00+09:00'), end: t('2026-11-27T00:00:00+09:00') })).toBe(
      '11月24日（火）〜11月26日（木） 終日',
    );
  });
});
