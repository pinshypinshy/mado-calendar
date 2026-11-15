// 閲覧者の一覧と追加（要件 3.3、7.5）。

import { Plus, User } from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';
import type { AdminApi } from '../api/clients';
import { errorMessage } from '../ui/errors';
import { Modal } from '../ui/Modal';
import { formatDateTime } from './format';
import { useLoad } from './useLoad';
import { ViewerDetail } from './ViewerDetail';

export function ViewersTab({ api }: { api: AdminApi }) {
  const { data, error, reload } = useLoad(useCallback(() => api.viewers(), [api]));
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  return (
    <section>
      <div className="page-head">
        <h2>閲覧者</h2>
        <button type="button" className="icon page-head-action" onClick={() => setAdding(true)} aria-label="閲覧者を追加">
          <Plus size={24} aria-hidden="true" />
        </button>
      </div>
      <ul className="plain-list">
        {data.map((v) => (
          <li key={v.id}>
            <button type="button" className="list-button viewer-cell" onClick={() => setSelected(v.id)}>
              <span className="viewer-avatar" aria-hidden="true">
                <User size={20} />
              </span>
              <span className="viewer-cell-text">
                <span>
                  {v.displayName}
                  {v.status === 'disabled' && <span className="badge">無効</span>}
                </span>
                <span className="muted small">
                  最終閲覧：{v.lastSeenAt === null ? 'まだ見ていません' : formatDateTime(v.lastSeenAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
        {data.length === 0 && <li className="muted">まだいません。右上の＋から追加できます</li>}
      </ul>
      {adding && (
        <AddViewerDialog
          api={api}
          onClose={() => setAdding(false)}
          // 追加したら詳細に移り、発行した閲覧者 ID と招待 URL を見せる（要件 3.3）
          onAdded={(id) => {
            setAdding(false);
            setSelected(id);
          }}
        />
      )}
    </section>
  );
}

/** 表示名を入れて閲覧者を追加するダイアログ（要件 7.5） */
function AddViewerDialog({
  api,
  onClose,
  onAdded,
}: {
  api: AdminApi;
  onClose: () => void;
  onAdded: (viewerId: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === '') return;
    setBusy(true);
    try {
      const v = await api.createViewer(name);
      onAdded(v.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="閲覧者を追加" onClose={onClose} placement="alert">
      <form onSubmit={(e) => void submit(e)}>
        <input
          className="alert-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="表示名（例：家族、友人）"
          aria-label="表示名"
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" className="primary-fill" disabled={busy || name.trim() === ''}>
            {busy ? '追加しています…' : '追加'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
