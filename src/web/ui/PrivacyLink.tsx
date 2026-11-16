// プライバシーポリシーへのリンク（要件 7.4）。ログインや参加の前に読めるよう、入口の画面と設定に置く。

import { useState } from 'react';
import { Modal } from './Modal';
import { PRIVACY_POLICY_PATH } from './privacyPolicy';

export function PrivacyLink() {
  const [open, setOpen] = useState(false);
  // ページを移らず、ダイアログの中に埋め込んで出す。ホーム画面に追加したアプリ（iPhone）では、
  // privacy.html に移ると、target="_blank" を付けても同じ画面で開き、戻るボタンが無いため元の画面に戻れなかった
  return (
    <>
      <button type="button" className="text-link muted small" onClick={() => setOpen(true)}>
        プライバシーポリシー
      </button>
      {open && (
        <Modal title="プライバシーポリシー" onClose={() => setOpen(false)}>
          <iframe className="privacy-frame" src={PRIVACY_POLICY_PATH} title="プライバシーポリシー" />
        </Modal>
      )}
    </>
  );
}
