// 画面の入口。URL のパスで、閲覧画面と管理画面を切り替える。
// API の実装（fetch）と端末の判定はここで作り、各画面に渡す。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin/AdminApp';
import { createAdminApi, createViewerApi } from './api/clients';
import { http } from './api/http';
import './styles.css';
import { isInAppBrowser, isStandalone } from './viewer/platform';
import { ViewerApp } from './viewer/ViewerApp';

const path = window.location.pathname;
const root = createRoot(document.getElementById('root')!);

if (path === '/admin' || path.startsWith('/admin/')) {
  document.title = '窓カレンダー 管理画面';
  root.render(
    <StrictMode>
      <AdminApp api={createAdminApi(http)} loginError={new URLSearchParams(window.location.search).get('login_error')} />
    </StrictMode>,
  );
} else {
  const inviteCode = path === '/join' ? decodeURIComponent(window.location.hash.slice(1)) || null : null;
  root.render(
    <StrictMode>
      <ViewerApp
        api={createViewerApi(http)}
        inviteCode={inviteCode}
        standalone={isStandalone(window)}
        inAppBrowser={isInAppBrowser(navigator.userAgent)}
        clearInviteFromUrl={clearInviteFromUrl}
      />
    </StrictMode>,
  );
}

function clearInviteFromUrl() {
  // ホーム画面に追加したときの URL に ID が残らないよう、/ に置き換える
  if (window.location.pathname === '/join') window.history.replaceState(null, '', '/');
}
