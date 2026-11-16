// プライバシーポリシーへのリンク（要件 7.4）。ログインや参加の前に読めるよう、入口の画面と設定に置く。

/** public/privacy.html の配信先。Google の同意画面に登録した URL と同じにする */
export const PRIVACY_POLICY_PATH = '/privacy.html';

export function PrivacyLink() {
  // 新しいタブで開く。privacy.html はホーム画面に追加したアプリの scope（/）の中にあるため、
  // 同じ画面で開くと、戻るボタンの無い画面に移ってしまい、元の画面に戻れなくなる
  return (
    <a className="muted small" href={PRIVACY_POLICY_PATH} target="_blank" rel="noopener">
      プライバシーポリシー
    </a>
  );
}
