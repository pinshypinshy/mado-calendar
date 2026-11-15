// 設定 → オーナー：運営者によるオーナーの管理（要件 3.10）。運営者にだけ表示する。
// 見せるのはオーナーの一覧の項目だけで、ほかのオーナーの予定や閲覧者は扱わない。

import { type FormEvent, useCallback, useState } from 'react';
import type { AdminApi } from '../../api/clients';
import { errorMessage } from '../../ui/errors';
import { formatDateTime } from '../format';
import { useLoad } from '../useLoad';

export function OwnersPage({ api }: { api: AdminApi }) {
  const { data, error, reload, setError } = useLoad(useCallback(() => api.owners(), [api]));
  const [email, setEmail] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.addOwner(email);
      setEmail('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`${label} をオーナーから削除しますか？そのオーナーの閲覧者・設定もすべて消え、元に戻せません。`)) return;
    try {
      await api.deleteOwner(id);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section>
      <h2>オーナー</h2>
      <p className="muted small">
        ここに追加した Google アカウントの人は、管理画面にログインして、自分のカレンダーを共有できます。ほかのオーナーの予定や閲覧者は、運営者の管理画面にも表示されません。
      </p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">読み込み中…</p>}
      {data && (
        <ul className="plain-list">
          {data.map((o) => (
            <li key={o.id} className="owner-row">
              <div>
                <div>
                  {o.displayName || '（名前未設定）'}
                  {o.isOperator && <span className="badge">運営者</span>}
                </div>
                <div className="muted small">{o.email}</div>
                <div className="muted small">
                  最終ログイン：{o.lastLoginAt === null ? 'まだログインしていません' : formatDateTime(o.lastLoginAt)}
                </div>
              </div>
              {!o.isOperator && (
                <button type="button" className="danger" onClick={() => void remove(o.id, o.displayName || o.email)}>
                  削除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={add}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="追加する人の Google アカウントのメールアドレス"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button type="submit" disabled={email.trim() === ''}>
          追加
        </button>
      </form>
      <p className="muted small">
        Google の審査を受けていないため、ログインできる人は合計100人までです。ログインの際に「確認されていないアプリ」という警告が出ます。
      </p>
    </section>
  );
}
