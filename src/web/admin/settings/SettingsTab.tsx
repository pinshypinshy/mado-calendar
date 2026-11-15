// 「設定」タブ：使う頻度の低い画面を、一覧 → 詳細の形でまとめる（要件 7.5）。

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { AdminMe } from '../../../shared/api';
import type { AdminApi } from '../../api/clients';
import { AccountPage } from './AccountPage';
import { CalendarsPage } from './CalendarsPage';
import { LabelsPage } from './LabelsPage';
import { OwnersPage } from './OwnersPage';

type Page = 'calendars' | 'labels' | 'account' | 'owners';
const PAGES: { id: Page; label: string; description: string; operatorOnly?: boolean }[] = [
  { id: 'calendars', label: 'カレンダー', description: '対象カレンダー・キャッシュ' },
  { id: 'labels', label: 'カテゴリ名', description: '全員共通のカテゴリ名' },
  { id: 'account', label: 'アカウント', description: '表示名・ログアウト' },
  { id: 'owners', label: 'オーナー', description: 'ログインできる人の管理', operatorOnly: true },
];

export function SettingsTab({
  api,
  me,
  onChanged,
  onLogout,
}: {
  api: AdminApi;
  me: AdminMe;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null);

  if (page !== null) {
    return (
      <>
        <button type="button" onClick={() => setPage(null)}>
          ‹ 設定
        </button>
        {page === 'calendars' && <CalendarsPage api={api} />}
        {page === 'labels' && <LabelsPage api={api} />}
        {page === 'account' && <AccountPage api={api} me={me} onChanged={onChanged} onLogout={onLogout} />}
        {page === 'owners' && me.isOperator && <OwnersPage api={api} />}
      </>
    );
  }

  return (
    <section>
      <h2>設定</h2>
      <ul className="settings-list">
        {PAGES.filter((p) => !p.operatorOnly || me.isOperator).map((p) => (
          <li key={p.id}>
            <button type="button" className="settings-item" onClick={() => setPage(p.id)}>
              <span className="settings-item-text">
                <span>{p.label}</span>
                <span className="muted small">{p.description}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
