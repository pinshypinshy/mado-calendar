// 設定 → アカウント：オーナーの表示名（要件 3.9）と、ログアウト（要件 3.1）。

import { useState } from 'react';
import type { AdminMe } from '../../../shared/api';
import type { AdminApi } from '../../api/clients';
import { errorMessage } from '../../ui/errors';
import { PrivacyLink } from '../../ui/PrivacyLink';

export function AccountPage({
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
      <button type="button" onClick={onLogout}>
        ログアウト
      </button>
      <p>
        <PrivacyLink />
      </p>
    </section>
  );
}
