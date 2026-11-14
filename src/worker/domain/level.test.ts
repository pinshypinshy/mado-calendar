import { describe, expect, test } from 'vitest';
import type { SourceEvent } from './event';
import { buildPolicy, resolveLevel, type OverrideRow, type RuleRow } from './level';
import type { TimeWindow } from './period';

const CAL = 'cal-main';
const NO_LIMIT: TimeWindow = { start: null, end: null };

function ev(over: Partial<SourceEvent> = {}): SourceEvent {
  return {
    calendarId: CAL,
    id: 'ev1',
    recurringEventId: null,
    title: 'ゼミ',
    start: Date.parse('2026-11-16T10:00:00+09:00'),
    end: Date.parse('2026-11-16T11:00:00+09:00'),
    allDay: false,
    eventLabelId: null,
    colorId: '7',
    ...over,
  };
}

function policy(rules: RuleRow[] = [], overrides: OverrideRow[] = [], window = NO_LIMIT) {
  return buildPolicy(window, rules, overrides);
}

describe('表示ルール', () => {
  test('ルールがなければ非表示', () => {
    expect(resolveLevel(ev(), policy())).toBe('hidden');
  });
  test('カレンダー×ラベルのルールに従う', () => {
    const p = policy([{ calendarId: CAL, labelKey: 'color:7', level: 'category' }]);
    expect(resolveLevel(ev(), p)).toBe('category');
  });
  test('別のカレンダーの同じラベルには効かない', () => {
    const p = policy([{ calendarId: 'other', labelKey: 'color:7', level: 'detail' }]);
    expect(resolveLevel(ev(), p)).toBe('hidden');
  });
  test('eventLabelId があれば colorId より優先する', () => {
    const p = policy([
      { calendarId: CAL, labelKey: 'label:abc', level: 'detail' },
      { calendarId: CAL, labelKey: 'color:7', level: 'busy' },
    ]);
    expect(resolveLevel(ev({ eventLabelId: 'abc' }), p)).toBe('detail');
  });
  test('ラベルなしの予定は「ラベルなし」の行に従う', () => {
    const p = policy([{ calendarId: CAL, labelKey: 'none', level: 'busy' }]);
    expect(resolveLevel(ev({ colorId: null }), p)).toBe('busy');
  });
});

describe('# ルール', () => {
  const rules: RuleRow[] = [{ calendarId: CAL, labelKey: 'color:7', level: 'detail' }];
  test('半角 # で始まる予定は、個別設定がなければ非表示', () => {
    expect(resolveLevel(ev({ title: '#通院' }), policy(rules))).toBe('hidden');
  });
  test('全角 ＃ は対象外', () => {
    expect(resolveLevel(ev({ title: '＃通院' }), policy(rules))).toBe('detail');
  });
  test('個別設定で「ラベルに従う」にすると表示ルールに従う', () => {
    const p = policy(rules, [{ calendarId: CAL, eventKey: 'ev1', level: 'inherit' }]);
    expect(resolveLevel(ev({ title: '#通院' }), p)).toBe('detail');
  });
  test('個別設定で直接レベルを指定できる', () => {
    const p = policy(rules, [{ calendarId: CAL, eventKey: 'ev1', level: 'busy' }]);
    expect(resolveLevel(ev({ title: '#通院' }), p)).toBe('busy');
  });
});

describe('個別設定', () => {
  const rules: RuleRow[] = [{ calendarId: CAL, labelKey: 'color:7', level: 'detail' }];
  const instance = ev({ id: 'series_20261116T010000Z', recurringEventId: 'series' });

  test('シリーズ全体の設定が各回に効く', () => {
    const p = policy(rules, [{ calendarId: CAL, eventKey: 'series', level: 'hidden' }]);
    expect(resolveLevel(instance, p)).toBe('hidden');
  });
  test('「この回のみ」を「シリーズ全体」より優先する', () => {
    const p = policy(rules, [
      { calendarId: CAL, eventKey: 'series', level: 'hidden' },
      { calendarId: CAL, eventKey: 'series_20261116T010000Z', level: 'busy' },
    ]);
    expect(resolveLevel(instance, p)).toBe('busy');
  });
  test('「この回のみ」が「ラベルに従う」なら、シリーズの設定ではなく表示ルールに従う', () => {
    const p = policy(rules, [
      { calendarId: CAL, eventKey: 'series', level: 'hidden' },
      { calendarId: CAL, eventKey: 'series_20261116T010000Z', level: 'inherit' },
    ]);
    expect(resolveLevel(instance, p)).toBe('detail');
  });
  test('個別設定はルールより強い（表示を広げることもできる）', () => {
    const p = policy([], [{ calendarId: CAL, eventKey: 'ev1', level: 'detail' }]);
    expect(resolveLevel(ev(), p)).toBe('detail');
  });
});

describe('期間制限', () => {
  const rules: RuleRow[] = [{ calendarId: CAL, labelKey: 'color:7', level: 'detail' }];
  test('許可期間の外は、個別設定があっても非表示', () => {
    const window = { start: null, end: Date.parse('2026-11-16T00:00:00+09:00') };
    const p = policy(rules, [{ calendarId: CAL, eventKey: 'ev1', level: 'detail' }], window);
    expect(resolveLevel(ev(), p)).toBe('hidden');
  });
  test('期間の境目にかかる予定は表示する', () => {
    const window = { start: Date.parse('2026-11-16T10:30:00+09:00'), end: null };
    expect(resolveLevel(ev(), policy(rules, [], window))).toBe('detail');
  });
});
