// ラベルの一覧とカテゴリ名・色の決め方（要件 3.4）。

import type { LabelKind } from '../../shared/api';
import {
  LEGACY_COLOR_IDS,
  NO_LABEL_KEY,
  type ColorPalette,
  type SourceCalendar,
  type SourceLabel,
} from './event';

export interface LabelInfo {
  calendarId: string;
  labelKey: string;
  kind: LabelKind;
  sourceName: string;
  color: string;
}

/** カレンダー1つ分のラベルの一覧。Google のラベル、従来の colorId、ラベルなし の順 */
export function buildLabelCatalog(
  calendar: SourceCalendar,
  labels: SourceLabel[],
  palette: ColorPalette,
): LabelInfo[] {
  const result: LabelInfo[] = labels.map((l) => ({
    calendarId: calendar.id,
    labelKey: `label:${l.id}`,
    kind: 'label',
    sourceName: l.name,
    color: l.color,
  }));
  for (const id of LEGACY_COLOR_IDS) {
    result.push({
      calendarId: calendar.id,
      labelKey: `color:${id}`,
      kind: 'color',
      sourceName: '',
      color: palette[id] ?? calendar.color,
    });
  }
  result.push({
    calendarId: calendar.id,
    labelKey: NO_LABEL_KEY,
    kind: 'none',
    sourceName: '',
    color: calendar.color,
  });
  return result;
}

/**
 * カテゴリ名の決め方：
 * 1. 管理画面で上書きした表示名
 * 2. ラベルの名前
 * 3. ラベルの名前が空欄、またはラベルなしの場合は、カレンダーの名前
 */
export function categoryNameOf(
  displayName: string | null | undefined,
  sourceName: string,
  calendarName: string,
): string {
  if (displayName && displayName.trim() !== '') return displayName.trim();
  if (sourceName.trim() !== '') return sourceName.trim();
  return calendarName;
}

export interface LabelAppearance {
  categoryName: string;
  color: string;
}

/** 予定のカレンダーとラベルキーから、カテゴリ名と色を引く */
export class LabelDirectory {
  private readonly calendars = new Map<string, SourceCalendar>();
  private readonly labels = new Map<string, LabelInfo>();
  private readonly displayNames = new Map<string, string>();

  constructor(
    calendars: SourceCalendar[],
    catalog: LabelInfo[],
    displayNames: { calendarId: string; labelKey: string; displayName: string }[],
  ) {
    for (const c of calendars) this.calendars.set(c.id, c);
    for (const l of catalog) this.labels.set(key(l.calendarId, l.labelKey), l);
    for (const d of displayNames) this.displayNames.set(key(d.calendarId, d.labelKey), d.displayName);
  }

  describe(calendarId: string, labelKey: string): LabelAppearance {
    const calendar = this.calendars.get(calendarId);
    const calendarName = calendar?.name ?? '';
    const calendarColor = calendar?.color ?? '#9e9e9e';
    const info = this.labels.get(key(calendarId, labelKey));
    const displayName = this.displayNames.get(key(calendarId, labelKey));
    if (!info) {
      // カタログにないラベル（削除されたラベルなど）はラベルなしと同じ見せ方にする
      return { categoryName: categoryNameOf(displayName, '', calendarName), color: calendarColor };
    }
    return {
      categoryName: categoryNameOf(displayName, info.sourceName, calendarName),
      color: info.color,
    };
  }

  calendarName(calendarId: string): string {
    return this.calendars.get(calendarId)?.name ?? '';
  }
}

function key(calendarId: string, labelKey: string): string {
  return `${calendarId}\u0000${labelKey}`;
}
