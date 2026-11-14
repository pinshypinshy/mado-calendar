// 端末・起動のしかたの判定（要件 4.2）。引数で受け取るので単体でテストできる。

/** ホーム画面に追加した Web アプリとして起動しているか */
export function isStandalone(win: { matchMedia(q: string): { matches: boolean }; navigator: Navigator }): boolean {
  return (
    win.matchMedia('(display-mode: standalone)').matches ||
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** LINE などのアプリ内ブラウザか */
export function isInAppBrowser(userAgent: string): boolean {
  return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK|Twitter/i.test(userAgent);
}
