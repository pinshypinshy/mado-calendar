// 画面から見た API。コンポーネントはこのインターフェースだけに依存し、実装は main.tsx で注入する。
// カレンダーの表示部品（CalendarScreen）は CalendarFeed だけを受け取るので、
// 閲覧画面と管理画面のプレビューで同じ部品を使える。

import type {
  AdminCalendar,
  AdminEventsResponse,
  AdminLabel,
  AdminViewerLabel,
  AdminMe,
  AdminViewerDetail,
  AdminViewerSummary,
  DateStr,
  DisplayRule,
  EventsResponse,
  JoinResponse,
  Level,
  MembershipsResponse,
  OverrideLevel,
  OwnerSummary,
  PeriodLimit,
  ViewerMe,
  WeekStart,
} from '../../shared/api';
import type { Http } from './http';

export interface CalendarFeed {
  me(): Promise<ViewerMe>;
  events(from: DateStr, to: DateStr, refresh: boolean): Promise<EventsResponse>;
  /** 週の開始曜日を保存する。プレビューでは保存しない */
  saveWeekStart?(weekStart: WeekStart): Promise<ViewerMe>;
}

export interface ViewerApi {
  join(code: string): Promise<JoinResponse>;
  /** 端末が参加しているオーナーの一覧と、表示するオーナー（要件 4.6） */
  memberships(): Promise<MembershipsResponse>;
  /** 表示するオーナーを覚えておく */
  select(viewerId: string): Promise<void>;
  /** 参加している閲覧者 ID 1つ分の予定の取り出し口 */
  feed(viewerId: string): CalendarFeed;
}

export function createViewerApi(http: Http): ViewerApi {
  return {
    join: (code) => http('POST', '/api/viewer/join', { code }),
    memberships: () => http('GET', '/api/viewer/memberships'),
    select: async (viewerId) => {
      await http('PUT', '/api/viewer/current', { viewerId });
    },
    feed: (viewerId) => {
      const v = { v: viewerId };
      return {
        me: () => http('GET', `/api/viewer/me?${new URLSearchParams(v)}`),
        events: (from, to, refresh) =>
          http(
            'GET',
            `/api/viewer/events?${new URLSearchParams({ ...v, from, to, ...(refresh ? { refresh: '1' } : {}) })}`,
          ),
        saveWeekStart: (weekStart) => http('PUT', `/api/viewer/settings?${new URLSearchParams(v)}`, { weekStart }),
      };
    },
  };
}

export interface AdminApi {
  me(): Promise<AdminMe>;
  logout(): Promise<void>;
  updateProfile(displayName: string): Promise<void>;
  /** 運営者だけ（要件 3.10） */
  owners(): Promise<OwnerSummary[]>;
  addOwner(email: string): Promise<OwnerSummary>;
  deleteOwner(ownerId: string): Promise<void>;
  calendars(): Promise<AdminCalendar[]>;
  selectCalendars(calendarIds: string[]): Promise<AdminCalendar[]>;
  labels(): Promise<AdminLabel[]>;
  renameLabel(calendarId: string, labelKey: string, displayName: string | null): Promise<AdminLabel[]>;
  viewers(): Promise<AdminViewerSummary[]>;
  createViewer(displayName: string): Promise<AdminViewerDetail>;
  viewer(id: string): Promise<AdminViewerDetail>;
  updateViewer(
    id: string,
    patch: { displayName?: string; defaultWeekStart?: WeekStart; period?: PeriodLimit },
  ): Promise<AdminViewerDetail>;
  disableViewer(id: string): Promise<AdminViewerDetail>;
  regenerateViewer(id: string): Promise<AdminViewerDetail>;
  deleteViewer(id: string): Promise<void>;
  copySettings(targetId: string, sourceViewerId: string): Promise<AdminViewerDetail>;
  rules(viewerId: string): Promise<DisplayRule[]>;
  /** 閲覧者1人から見たラベルの一覧（閲覧者ごとのカテゴリ名つき） */
  viewerLabels(viewerId: string): Promise<AdminViewerLabel[]>;
  renameViewerLabel(
    viewerId: string,
    calendarId: string,
    labelKey: string,
    displayName: string | null,
  ): Promise<AdminViewerLabel[]>;
  setRule(viewerId: string, calendarId: string, labelKey: string, level: Level): Promise<DisplayRule[]>;
  events(from: DateStr, to: DateStr): Promise<AdminEventsResponse>;
  setOverride(viewerId: string, calendarId: string, eventKey: string, level: OverrideLevel | null): Promise<void>;
  clearCache(): Promise<void>;
  preview(viewerId: string): CalendarFeed;
}

export function createAdminApi(http: Http): AdminApi {
  const v = (id: string) => `/api/admin/viewers/${encodeURIComponent(id)}`;
  return {
    me: () => http('GET', '/api/admin/me'),
    logout: async () => {
      await http('POST', '/auth/logout');
    },
    updateProfile: async (displayName) => {
      await http('PUT', '/api/admin/profile', { displayName });
    },
    owners: () => http('GET', '/api/admin/owners'),
    addOwner: (email) => http('POST', '/api/admin/owners', { email }),
    deleteOwner: async (ownerId) => {
      await http('DELETE', `/api/admin/owners/${encodeURIComponent(ownerId)}`);
    },
    calendars: () => http('GET', '/api/admin/calendars'),
    selectCalendars: (calendarIds) => http('PUT', '/api/admin/calendars', { calendarIds }),
    labels: () => http('GET', '/api/admin/labels'),
    renameLabel: (calendarId, labelKey, displayName) =>
      http('PUT', '/api/admin/labels', { calendarId, labelKey, displayName }),
    viewers: () => http('GET', '/api/admin/viewers'),
    createViewer: (displayName) => http('POST', '/api/admin/viewers', { displayName }),
    viewer: (id) => http('GET', v(id)),
    updateViewer: (id, patch) => http('PATCH', v(id), patch),
    disableViewer: (id) => http('POST', `${v(id)}/disable`),
    regenerateViewer: (id) => http('POST', `${v(id)}/regenerate`),
    deleteViewer: async (id) => {
      await http('DELETE', v(id));
    },
    copySettings: (targetId, sourceViewerId) => http('POST', `${v(targetId)}/copy-from`, { sourceViewerId }),
    rules: (viewerId) => http('GET', `${v(viewerId)}/rules`),
    viewerLabels: (viewerId) => http('GET', `${v(viewerId)}/labels`),
    renameViewerLabel: (viewerId, calendarId, labelKey, displayName) =>
      http('PUT', `${v(viewerId)}/labels`, { calendarId, labelKey, displayName }),
    setRule: (viewerId, calendarId, labelKey, level) =>
      http('PUT', `${v(viewerId)}/rules`, { calendarId, labelKey, level }),
    events: (from, to) => http('GET', `/api/admin/events?${new URLSearchParams({ from, to })}`),
    setOverride: async (viewerId, calendarId, eventKey, level) => {
      await http('PUT', '/api/admin/overrides', { viewerId, calendarId, eventKey, level });
    },
    clearCache: async () => {
      await http('POST', '/api/admin/cache/clear');
    },
    preview: (viewerId) => ({
      me: () => http('GET', `${v(viewerId)}/preview/me`),
      events: (from, to, refresh) =>
        http(
          'GET',
          `${v(viewerId)}/preview/events?${new URLSearchParams({ from, to, ...(refresh ? { refresh: '1' } : {}) })}`,
        ),
    }),
  };
}
