// オーナー自身の設定：表示名（要件 3.9）。

import { useState } from 'react';
import type { AdminMe } from '../../shared/api';
import type { AdminApi } from '../api/clients';
import { errorMessage } from '../ui/errors';

export function SettingsTab({ api, me, onChanged }: { api: AdminApi; me: AdminMe; onChanged: () => void }) {
  const [name, setName] = useState(me.displayName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api.updateProfile(name);
      setError(null);
      setMessage('保存しました');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section>
      <h2>表示名</h2>
      <p className="muted small">
        閲覧者が複数の人のカレンダーを見ているとき、切り替えのボタンにこの名前が出ます。空欄のときは「（名前未設定）」と出ます。メールアドレスは閲覧者に見せません。
      </p>
      <div className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田" maxLength={30} />
        <button type="button" disabled={name.trim() === me.displayName} onClick={() => void save()}>
          保存
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
      {error && <p className="error">{error}</p>}
      <h2>アカウント</h2>
      <p className="muted small">{me.email} でログインしています。</p>
    </section>
  );
}
