// 画面と API の間でやり取りするデータの型。
// worker と web の両方から読み込むことで、食い違いを型エラーとして検出する。

import type { DateStr, WeekStart } from './time';

export type { DateStr, WeekStart };

/** 表示レベル（要件 3.4） */
export type Level = 'detail' | 'category' | 'busy' | 'hidden';
export const LEVELS: readonly Level[] = ['detail', 'category', 'busy', 'hidden'];

/** 個別設定の値（要件 3.5）。inherit = ラベルに従う */
export type OverrideLevel = Level | 'inherit';
export const OVERRIDE_LEVELS: readonly OverrideLevel[] = ['inherit', 'detail', 'category', 'busy', 'hidden'];

export const LEVEL_LABELS: Record<OverrideLevel, string> = {
  inherit: 'ラベルに従う',
  detail: '詳細',
  category: 'カテゴリ',
  busy: '予定あり',
  hidden: '非表示',
};

// ---- 閲覧者向け ----

/** 閲覧者に返す予定。表示レベルで見せてよい項目だけを持つ（要件 7.1） */
export type ViewerEvent =
  | (ViewerEventBase & { level: 'detail'; title: string; category: string })
  | (ViewerEventBase & { level: 'category'; category: string })
  | (ViewerEventBase & { level: 'busy' });

export interface ViewerEventBase {
  /** レスポンス内でだけ一意な識別子（Google の予定 ID は返さない） */
  id: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
}

/** 閲覧できる日付の範囲。min は含み、max は含まない。null は制限なし */
export interface DateBounds {
  min: DateStr | null;
  max: DateStr | null;
}

export interface ViewerMe {
  displayName: string;
  weekStart: WeekStart;
  bounds: DateBounds;
}

export interface EventsResponse {
  events: ViewerEvent[];
}

export interface JoinRequest {
  code: string;
}

export interface JoinResponse {
  /** 参加した閲覧者。これを選択中にする */
  viewerId: string;
}

/** 端末が参加している閲覧者 ID 1つ分（要件 4.6）。オーナーのメールアドレスは含めない */
export interface Membership {
  viewerId: string;
  ownerName: string;
}

export interface MembershipsResponse {
  memberships: Membership[];
  /** 表示するオーナーの閲覧者 ID（最後に選んだもの。表示できなければ最初に参加したもの） */
  current: string;
}

export interface SelectMembershipRequest {
  viewerId: string;
}

export interface ViewerSettingsRequest {
  weekStart: WeekStart;
}

// ---- 管理者向け ----

export interface PeriodLimit {
  enabled: boolean;
  /** 過去に何か月までさかのぼれるか。null は制限なし */
  pastMonths: number | null;
  /** 未来に何か月先まで見られるか。null は制限なし */
  futureMonths: number | null;
}

export interface AdminMe {
  email: string;
  displayName: string;
  isOperator: boolean;
  calendarConnected: boolean;
  mode: 'google' | 'fake';
}

export interface UpdateProfileRequest {
  displayName: string;
}

/** 運営者に見せるオーナーの情報（要件 3.10）。これ以外のオーナーのデータは運営者にも見せない */
export interface OwnerSummary {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  lastLoginAt: number | null;
  isOperator: boolean;
}

export interface AddOwnerRequest {
  email: string;
}

export interface AdminViewerSummary {
  id: string;
  displayName: string;
  status: 'active' | 'disabled';
  createdAt: number;
  lastSeenAt: number | null;
}

export interface AdminViewerDetail extends AdminViewerSummary {
  code: string;
  inviteUrl: string;
  defaultWeekStart: WeekStart;
  period: PeriodLimit;
}

export interface CreateViewerRequest {
  displayName: string;
}

export interface UpdateViewerRequest {
  displayName?: string;
  defaultWeekStart?: WeekStart;
  period?: PeriodLimit;
}

export interface CopySettingsRequest {
  sourceViewerId: string;
}

export interface AdminCalendar {
  id: string;
  name: string;
  color: string;
  selected: boolean;
}

export interface SelectCalendarsRequest {
  calendarIds: string[];
}

/**
 * ラベルの種類。
 * - label: Google のラベル（eventLabelId）
 * - none: ラベルなし
 */
export type LabelKind = 'label' | 'none';

export interface AdminLabel {
  calendarId: string;
  labelKey: string;
  kind: LabelKind;
  /** Google 側の名前。空欄のことがある */
  sourceName: string;
  /** 管理画面で上書きした表示名 */
  displayName: string | null;
  /** 閲覧者に見せるカテゴリ名（要件 3.4 の決め方で決めた結果） */
  categoryName: string;
  color: string;
}

/** 閲覧者1人から見たラベル（管理画面の表示ルールの行） */
export interface AdminViewerLabel extends AdminLabel {
  /** この閲覧者だけの上書き */
  viewerDisplayName: string | null;
  /** この閲覧者に見せるカテゴリ名 */
  viewerCategoryName: string;
}

export interface RenameLabelRequest {
  calendarId: string;
  labelKey: string;
  displayName: string | null;
}

export interface DisplayRule {
  calendarId: string;
  labelKey: string;
  level: Level;
}

export interface SetRuleRequest extends DisplayRule {}

export interface AdminEventViewerState {
  viewerId: string;
  /** 「この回のみ」の個別設定 */
  instanceLevel: OverrideLevel | null;
  /** 「シリーズ全体」の個別設定（繰り返しでない予定はこちらを使う） */
  seriesLevel: OverrideLevel | null;
  /** 実際に閲覧者に見える表示レベル */
  effective: Level;
}

export interface AdminEvent {
  calendarId: string;
  calendarName: string;
  eventId: string;
  /** 繰り返し予定のシリーズの ID。繰り返しでなければ null */
  recurringEventId: string | null;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  labelKey: string;
  categoryName: string;
  color: string;
  viewers: AdminEventViewerState[];
}

export interface AdminEventsResponse {
  events: AdminEvent[];
  viewers: AdminViewerSummary[];
}

export interface SetOverrideRequest {
  viewerId: string;
  calendarId: string;
  /** 「この回のみ」なら予定の ID、「シリーズ全体」ならシリーズの ID */
  eventKey: string;
  /** null で個別設定を消し、初期値に戻す */
  level: OverrideLevel | null;
}

export interface ApiError {
  error: string;
  message: string;
}
