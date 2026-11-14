// Worker の入口。

import { buildServices } from './container';
import type { AppEnv } from './env';
import { createApp } from './http/app';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export default {
  async fetch(request, env, ctx) {
    // フェイクのカレンダーとログインは、誤って本番で有効にしても動かないようにする
    if (env.CALENDAR_SOURCE === 'fake' && !LOCAL_HOSTS.has(new URL(request.url).hostname)) {
      return new Response('CALENDAR_SOURCE=fake はローカル開発専用です', { status: 500 });
    }
    const services = await buildServices(env);
    return createApp(services).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
