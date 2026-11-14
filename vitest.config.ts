import { defineConfig } from 'vitest/config';

// vite.config.ts（Cloudflare プラグイン入り）は読み込まず、Node 上で素のテストとして動かす。
// D1 が必要なテストは src/worker/testing/d1.ts で wrangler の getPlatformProxy を使う。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
