// 管理画面（要件 3章）。

import { CalendarDays, type LucideIcon, Settings, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AdminMe } from '../../shared/api';
import type { AdminApi } from '../api/clients';
import { errorMessage, isUnauthorized } from '../ui/errors';
import { EventsTab } from './EventsTab';
import { SettingsTab } from './settings/SettingsTab';
import { ViewersTab } from './ViewersTab';

// よく使う画面だけをタブにし、使う頻度の低い画面は「設定」の中にまとめる（要件 7.5）
type Tab = 'viewers' | 'events' | 'settings';
const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'viewers', label: '閲覧者', Icon: Users },
  { id: 'events', label: '予定', Icon: CalendarDays },
  { id: 'settings', label: '設定', Icon: Settings },
];

export function AdminApp({ api, loginError }: { api: AdminApi; loginError: string | null }) {
  const [me, setMe] = useState<AdminMe | 'unauthorized' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('viewers');
  // タブを押すたびに中身を作り直す。今いるタブを押し直すと、そのタブの最初の画面（一覧など）に戻る
  const [visit, setVisit] = useState(0);

  const loadMe = useCallback(() => {
    api
      .me()
      .then(setMe)
      .catch((e: unknown) => (isUnauthorized(e) ? setMe('unauthorized') : setError(errorMessage(e))));
  }, [api]);
  useEffect(loadMe, [loadMe]);

  const logout = useCallback(async () => {
    // 押し間違えでログアウトしないよう、必ず確認する（要件 3.1）
    if (!confirm('ログアウトしますか？')) return;
    await api.logout();
    setMe('unauthorized');
  }, [api]);

  if (error) return <div className="center-box">{error}</div>;
  if (me === null) return <div className="cal-status">読み込み中…</div>;
  if (me === 'unauthorized') {
    return (
      <div className="center-box">
        <h1>窓カレンダー 管理画面</h1>
        {loginError && <p className="error">{loginError}</p>}
        <a className="button" href="/auth/login">
          Google でログイン
        </a>
        <p className="muted small">運営者が追加した Google アカウントだけがログインできます。</p>
        <LoginAs />
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin-header">
        <strong>窓カレンダー 管理</strong>
        <span className="muted small">{me.displayName || me.email}</span>
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
      <div className="admin-body">
        {/* 狭い画面では画面下のタブバー、広い画面では左のサイドバーになる（置き方は CSS だけで切り替える） */}
        <nav className="admin-nav" aria-label="管理画面のメニュー">
          {TABS.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => {
                setTab(id);
                setVisit((n) => n + 1);
              }}
            >
              <Icon size={22} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <main className="admin-main" key={visit}>
          {tab === 'viewers' && <ViewersTab api={api} />}
          {tab === 'events' && <EventsTab api={api} />}
          {tab === 'settings' && <SettingsTab api={api} me={me} onChanged={loadMe} onLogout={() => void logout()} />}
        </main>
      </div>
    </div>
  );
}

/**
 * アカウントを指定してログインする。Google では login_hint（アカウントの候補）として使い、
 * フェイクモード（ローカル開発）では、そのアカウントとしてそのままログインする。
 */
function LoginAs() {
  const [email, setEmail] = useState('');
  return (
    <details>
      <summary className="muted small">アカウントを指定してログイン</summary>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          window.location.href = `/auth/login?${new URLSearchParams({ as: email.trim() })}`;
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" />
        <button type="submit" disabled={email.trim() === ''}>
          ログイン
        </button>
      </form>
    </details>
  );
}
