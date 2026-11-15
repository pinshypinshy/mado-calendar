import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 閲覧画面（index.html）と管理画面（admin.html）は、同じ main.tsx を読み込み、パスで画面を切り替える。
// HTML を分けているのは、ホーム画面に追加したときの起動先と名前・アイコンを別にするため。
// 本番では Cloudflare の静的ファイルの配信が /admin に admin.html を返す。
export default defineConfig({
  plugins: [react(), cloudflare()],
  environments: {
    // 画面のビルドだけに指定する（Worker のビルドには適用しない）
    client: {
      build: {
        rollupOptions: {
          input: { main: 'index.html', admin: 'admin.html' },
        },
      },
    },
  },
});
