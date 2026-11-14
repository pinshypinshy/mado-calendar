// 閲覧者の一覧と追加（要件 3.3）。

import { type FormEvent, useCallback, useState } from 'react';
import type { AdminApi } from '../api/clients';
import { errorMessage } from '../ui/errors';
import { formatDateTime } from './format';
import { useLoad } from './useLoad';
import { ViewerDetail } from './ViewerDetail';

export function ViewersTab({ api }: { api: AdminApi }) {
  const { data, error, reload, setError } = useLoad(useCallback(() => api.viewers(), [api]));
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');

  if (selected) {
    return (
      <ViewerDetail
        api={api}
        viewerId={selected}
        onBack={() => {
          setSelected(null);
          void reload();
        }}
      />
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const v = await api.createViewer(name);
      setName('');
      setSelected(v.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section>
      <h2>閲覧者</h2>
      <ul className="plain-list">
        {data.map((v) => (
          <li key={v.id}>
            <button type="button" className="list-button" onClick={() => setSelected(v.id)}>
              <span>
                {v.displayName}
                {v.status === 'disabled' && <span className="badge">無効</span>}
              </span>
              <span className="muted small">
                最終閲覧：{v.lastSeenAt === null ? 'まだ見ていません' : formatDateTime(v.lastSeenAt)}
              </span>
            </button>
          </li>
        ))}
        {data.length === 0 && <li className="muted">まだいません</li>}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="表示名（例：家族、友人）" />
        <button type="submit" disabled={name.trim() === ''}>
          追加
        </button>
      </form>
    </section>
  );
}
