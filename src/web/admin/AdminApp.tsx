// 管理画面（要件 3章）。

import { useCallback, useEffect, useState } from 'react';
import type { AdminMe } from '../../shared/api';
import type { AdminApi } from '../api/clients';
import { errorMessage, isUnauthorized } from '../ui/errors';
import { CalendarsTab } from './CalendarsTab';
import { EventsTab } from './EventsTab';
import { LabelsTab } from './LabelsTab';
import { ViewersTab } from './ViewersTab';

type Tab = 'viewers' | 'calendars' | 'labels' | 'events';
const TABS: { id: Tab; label: string }[] = [
  { id: 'viewers', label: '閲覧者' },
  { id: 'events', label: '予定' },
  { id: 'labels', label: 'ラベル' },
  { id: 'calendars', label: 'カレンダー' },
];

export function AdminApp({ api, loginError }: { api: AdminApi; loginError: string | null }) {
  const [me, setMe] = useState<AdminMe | 'unauthorized' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('viewers');

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((e: unknown) => (isUnauthorized(e) ? setMe('unauthorized') : setError(errorMessage(e))));
  }, [api]);

  const logout = useCallback(async () => {
    await api.logout();
    setMe('unauthorized');
  }, [api]);

  if (error) return <div className="center-box">{error}</div>;
  if (me === null) return <div className="cal-status">読み込み中…</div>;
  if (me === 'unauthorized') {
    return (
      <div className="center-box">
        <h1>mado-cal 管理画面</h1>
        {loginError && <p className="error">{loginError}</p>}
        <a className="button" href="/auth/login">
          Google でログイン
        </a>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin-header">
        <strong>mado-cal 管理</strong>
        <span className="muted small">{me.email}</span>
        <button type="button" onClick={() => void logout()}>
          ログアウト
        </button>
      </header>
      {me.mode === 'fake' && (
        <div className="banner banner-warn">
          フェイクのカレンダーで動いています（CALENDAR_SOURCE=fake）。Google の本物のデータではありません。
        </div>
      )}
      {!me.calendarConnected && (
        <div className="banner banner-error">
          Google カレンダーと連携していません。いったんログアウトし、ログインし直すときにカレンダーへのアクセスを許可してください。
        </div>
      )}
      <nav className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="admin-main">
        {tab === 'viewers' && <ViewersTab api={api} />}
        {tab === 'events' && <EventsTab api={api} />}
        {tab === 'labels' && <LabelsTab api={api} />}
        {tab === 'calendars' && <CalendarsTab api={api} />}
      </main>
    </div>
  );
}
