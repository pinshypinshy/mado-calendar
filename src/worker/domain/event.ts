// カレンダーから取り出した予定と、カレンダー・ラベルの情報。
// Google の API の形に依存しない形に正規化したもの（変換は adapters/google 側で行う）。

export interface SourceEvent {
  calendarId: string;
  /** 予定の ID。繰り返し予定では回ごとに異なる */
  id: string;
  /** 繰り返し予定のシリーズの ID。繰り返しでなければ null */
  recurringEventId: string | null;
  title: string;
  /** epoch ミリ秒 */
  start: number;
  /** epoch ミリ秒（この時刻を含まない） */
  end: number;
  allDay: boolean;
  eventLabelId: string | null;
  colorId: string | null;
}

export interface SourceCalendar {
  id: string;
  name: string;
  color: string;
}

export interface SourceLabel {
  id: string;
  name: string;
  color: string;
}

export const NO_LABEL_KEY = 'none';

/**
 * 予定のラベルを表すキー。
 * Google は予定の eventLabelId を返す（要件 10章 #1 で確認済み）。返らない予定に備えて colorId での判定も残す。
 * colorId のキー（color:N）は管理画面に出さないので、表示ルールを設定できず、初期値の「非表示」になる。
 */
export function labelKeyOf(e: Pick<SourceEvent, 'eventLabelId' | 'colorId'>): string {
  if (e.eventLabelId) return `label:${e.eventLabelId}`;
  if (e.colorId) return `color:${e.colorId}`;
  return NO_LABEL_KEY;
}


/** 「シリーズ全体」の個別設定のキー */
export function seriesKeyOf(e: Pick<SourceEvent, 'id' | 'recurringEventId'>): string {
  return e.recurringEventId ?? e.id;
}
