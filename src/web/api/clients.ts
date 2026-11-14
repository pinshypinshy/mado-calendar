// 画面から見た API。コンポーネントはこのインターフェースだけに依存し、実装は main.tsx で注入する。
// カレンダーの表示部品（CalendarScreen）は CalendarFeed だけを受け取るので、
// 閲覧画面と管理画面のプレビューで同じ部品を使える。

import type {
  AdminCalendar,
  AdminEventsResponse,
  AdminLabel,
  AdminMe,
  AdminViewerDetail,
  AdminViewerSummary,
  DateStr,
  DisplayRule,
  EventsResponse,
  Level,
  OverrideLevel,
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

export interface ViewerApi extends CalendarFeed {
  join(code: string): Promise<void>;
}

export function createViewerApi(http: Http): ViewerApi {
  return {
    join: async (code) => {
      await http('POST', '/api/viewer/join', { code });
    },
    me: () => http('GET', '/api/viewer/me'),
    events: (from, to, refresh) =>
      http('GET', `/api/viewer/events?${new URLSearchParams({ from, to, ...(refresh ? { refresh: '1' } : {}) })}`),
    saveWeekStart: (weekStart) => http('PUT', '/api/viewer/settings', { weekStart }),
  };
}

export interface AdminApi {
  me(): Promise<AdminMe>;
  logout(): Promise<void>;
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
