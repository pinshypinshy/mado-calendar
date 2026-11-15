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

/** 表示名の上書き1件（全員共通と閲覧者ごとで同じ形） */
export interface LabelNameRow {
  calendarId: string;
  labelKey: string;
  displayName: string;
}

/**
 * カテゴリ名の決め方（要件 3.4）：
 * 1. 閲覧者ごとに上書きした表示名
 * 2. 全員共通で上書きした表示名
 * 3. ラベルの名前
 * 4. ラベルの名前が空欄、またはラベルなしの場合は、カレンダーの名前
 */
export function categoryNameOf(p: {
  viewerName?: string | null | undefined;
  globalName?: string | null | undefined;
  sourceName: string;
  calendarName: string;
}): string {
  for (const name of [p.viewerName, p.globalName, p.sourceName]) {
    if (name && name.trim() !== '') return name.trim();
  }
  return p.calendarName;
}

export interface LabelAppearance {
  categoryName: string;
  color: string;
}

/** 予定のカレンダーとラベルキーから、カテゴリ名と色を引く */
export class LabelDirectory {
  private readonly calendars = new Map<string, SourceCalendar>();
  private readonly labels = new Map<string, LabelInfo>();
  private readonly globalNames = new Map<string, string>();
  private readonly viewerNames = new Map<string, string>();

  /**
   * @param globalNames 全員共通の上書き
   * @param viewerNames 閲覧者ごとの上書き。閲覧者を決めずに使う場合（管理画面の予定一覧など）は空
   */
  constructor(
    private readonly sourceCalendars: SourceCalendar[],
    private readonly catalog: LabelInfo[],
    private readonly globalNameRows: LabelNameRow[],
    viewerNames: LabelNameRow[] = [],
  ) {
    for (const c of sourceCalendars) this.calendars.set(c.id, c);
    for (const l of catalog) this.labels.set(key(l.calendarId, l.labelKey), l);
    for (const d of globalNameRows) this.globalNames.set(key(d.calendarId, d.labelKey), d.displayName);
    for (const d of viewerNames) this.viewerNames.set(key(d.calendarId, d.labelKey), d.displayName);
  }

  /** 閲覧者ごとの上書きを加えた LabelDirectory を返す（このインスタンスは変えない） */
  withViewerNames(viewerNames: LabelNameRow[]): LabelDirectory {
    return new LabelDirectory(this.sourceCalendars, this.catalog, this.globalNameRows, viewerNames);
  }

  describe(calendarId: string, labelKey: string): LabelAppearance {
    const calendar = this.calendars.get(calendarId);
    const k = key(calendarId, labelKey);
    const info = this.labels.get(k);
    return {
      categoryName: categoryNameOf({
        viewerName: this.viewerNames.get(k),
        globalName: this.globalNames.get(k),
        // カタログにないラベル（削除されたラベルなど）はラベルなしと同じ見せ方にする
        sourceName: info?.sourceName ?? '',
        calendarName: calendar?.name ?? '',
      }),
      color: info?.color ?? calendar?.color ?? '#9e9e9e',
    };
  }

  calendarName(calendarId: string): string {
    return this.calendars.get(calendarId)?.name ?? '';
  }
}

function key(calendarId: string, labelKey: string): string {
  return `${calendarId}\u0000${labelKey}`;
}
