// 表示判定ロジック（要件 5章）。判定はすべてサーバー側で行う。

import type { Level, OverrideLevel } from '../../shared/api';
import { labelKeyOf, type SourceEvent, seriesKeyOf } from './event';
import { overlapsWindow, type TimeWindow } from './period';

export interface ViewerPolicy {
  window: TimeWindow;
  /** 表示ルール：(calendarId, labelKey) → 表示レベル */
  rule(calendarId: string, labelKey: string): Level | undefined;
  /** 個別設定：(calendarId, eventKey) → 値 */
  override(calendarId: string, eventKey: string): OverrideLevel | undefined;
}

export function resolveLevel(e: SourceEvent, p: ViewerPolicy): Level {
  // 1. 期間制限
  if (!overlapsWindow(e, p.window)) return 'hidden';

  // 2. 個別設定（「この回のみ」を「シリーズ全体」より優先する）
  const o = p.override(e.calendarId, e.id) ?? p.override(e.calendarId, seriesKeyOf(e));
  if (o !== undefined && o !== 'inherit') return o;
  if (o === 'inherit') return ruleLevel(e, p);

  // 3. # ルール（個別設定が未設定のときの初期値。半角 # のみ）
  if (isHashTitle(e.title)) return 'hidden';

  // 4. 表示ルール
  return ruleLevel(e, p);
}

function ruleLevel(e: SourceEvent, p: ViewerPolicy): Level {
  return p.rule(e.calendarId, labelKeyOf(e)) ?? 'hidden';
}

export function isHashTitle(title: string): boolean {
  return title.startsWith('#');
}

export interface RuleRow {
  calendarId: string;
  labelKey: string;
  level: Level;
}

export interface OverrideRow {
  calendarId: string;
  eventKey: string;
  level: OverrideLevel;
}

export function buildPolicy(window: TimeWindow, rules: RuleRow[], overrides: OverrideRow[]): ViewerPolicy {
  const ruleMap = new Map<string, Level>();
  for (const r of rules) ruleMap.set(k(r.calendarId, r.labelKey), r.level);
  const overrideMap = new Map<string, OverrideLevel>();
  for (const o of overrides) overrideMap.set(k(o.calendarId, o.eventKey), o.level);
  return {
    window,
    rule: (calendarId, labelKey) => ruleMap.get(k(calendarId, labelKey)),
    override: (calendarId, eventKey) => overrideMap.get(k(calendarId, eventKey)),
  };
}

function k(a: string, b: string): string {
  return `${a}\u0000${b}`;
}
