// 判定した表示レベルに応じて、閲覧者に返す項目を絞り込む（要件 3.4、7.1）。
// 説明欄・場所・参加者などは SourceEvent に含めていないので、ここで漏れることはない。

import type { Level, ViewerEvent } from '../../shared/api';
import type { SourceEvent } from './event';
import type { LabelAppearance } from './labels';

export const BUSY_COLOR = '#9e9e9e';
export const UNTITLED = '（タイトルなし）';

export function presentForViewer(
  e: SourceEvent,
  level: Level,
  label: LabelAppearance,
  id: string,
): ViewerEvent | null {
  const base = { id, start: e.start, end: e.end, allDay: e.allDay };
  switch (level) {
    case 'hidden':
      return null;
    case 'busy':
      return { ...base, level: 'busy', color: BUSY_COLOR };
    case 'category':
      return { ...base, level: 'category', category: label.categoryName, color: label.color };
    case 'detail':
      return {
        ...base,
        level: 'detail',
        title: displayTitle(e.title),
        category: label.categoryName,
        color: label.color,
      };
  }
}

/** # ルールの対象だが表示を許可した予定は、先頭の # を取り除く（要件 4.3） */
export function displayTitle(title: string): string {
  const t = title.startsWith('#') ? title.slice(1).trimStart() : title;
  return t.trim() === '' ? UNTITLED : t;
}
