import type { AdminCalendar, AdminLabel } from '../../shared/api';

export interface LabelGroup {
  calendar: AdminCalendar;
  /** Google のラベル */
  labels: AdminLabel[];
  /** 従来の colorId（eventLabelId が返らない場合の予備） */
  colors: AdminLabel[];
  /** ラベルなし */
  none: AdminLabel[];
}

export function groupLabels(labels: AdminLabel[], calendars: AdminCalendar[]): LabelGroup[] {
  return calendars
    .filter((c) => c.selected)
    .map((calendar) => {
      const mine = labels.filter((l) => l.calendarId === calendar.id);
      return {
        calendar,
        labels: mine.filter((l) => l.kind === 'label'),
        colors: mine.filter((l) => l.kind === 'color'),
        none: mine.filter((l) => l.kind === 'none'),
      };
    });
}

export function labelTitle(l: AdminLabel): string {
  if (l.kind === 'none') return 'ラベルなし';
  if (l.kind === 'color') return `colorId ${l.labelKey.slice('color:'.length)}`;
  return l.sourceName === '' ? '（名前なしのラベル）' : l.sourceName;
}
