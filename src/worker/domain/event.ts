// カレンダーから取り出した予定と、カレンダー・ラベルの情報。
// Google の API の形に依存しない形に正規化したもの（変換は adapters/google 側で行う）。

import type { LabelKind } from '../../shared/api';

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

/** colorId（"1"〜"11"）→ 色コード */
export type ColorPalette = Record<string, string>;

export const NO_LABEL_KEY = 'none';
export const LEGACY_COLOR_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] as const;

/**
 * 予定のラベルを表すキー。
 * eventLabelId が返る場合はそれを優先し、返らない場合は colorId を使う。
 * どちらが実際に返るかは未検証（要件 10章 #1）なので、両方に対応している。
 */
export function labelKeyOf(e: Pick<SourceEvent, 'eventLabelId' | 'colorId'>): string {
  if (e.eventLabelId) return `label:${e.eventLabelId}`;
  if (e.colorId) return `color:${e.colorId}`;
  return NO_LABEL_KEY;
}

export function labelKindOf(labelKey: string): LabelKind {
  if (labelKey.startsWith('label:')) return 'label';
  if (labelKey.startsWith('color:')) return 'color';
  return 'none';
}

/** 「シリーズ全体」の個別設定のキー */
export function seriesKeyOf(e: Pick<SourceEvent, 'id' | 'recurringEventId'>): string {
  return e.recurringEventId ?? e.id;
}
