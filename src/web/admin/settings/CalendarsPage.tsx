// 設定 → カレンダー：対象カレンダーの選択とキャッシュ（要件 3.2）。

import { useCallback, useState } from 'react';
import type { AdminApi } from '../../api/clients';
import { errorMessage } from '../../ui/errors';
import { useLoad } from '../useLoad';

export function CalendarsPage({ api }: { api: AdminApi }) {
  const { data, error, setData, setError } = useLoad(useCallback(() => api.calendars(), [api]));
  const [message, setMessage] = useState<string | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const toggle = async (id: string, checked: boolean) => {
    const ids = data.filter((c) => (c.id === id ? checked : c.selected)).map((c) => c.id);
    try {
      setData(await api.selectCalendars(ids));
      setMessage('保存しました');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const clearCache = async () => {
    await api.clearCache();
    setMessage('キャッシュを消しました。次の表示で Google から取り直します');
  };

  return (
    <section>
      <h2>対象カレンダー</h2>
      <p className="muted small">アプリで扱うカレンダーを選びます。選んでいないカレンダーの予定は、どの閲覧者にも見えません。</p>
      <ul className="plain-list">
        {data.map((c) => (
          <li key={c.id}>
            <label className="check">
              <input type="checkbox" checked={c.selected} onChange={(e) => void toggle(c.id, e.target.checked)} />
              <span className="swatch" style={{ background: c.color }} />
              <span>{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <h2>キャッシュ</h2>
      <p className="muted small">Google から取得したデータは5分間キャッシュしています。ラベルを変えた直後などに使います。</p>
      <button type="button" onClick={() => void clearCache()}>
        キャッシュを消す
      </button>
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
