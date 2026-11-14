// Worker の入口。

import { buildServices } from './container';
import type { AppEnv } from './env';
import { createApp, isLocalHost } from './http/app';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 本番で http のまま閲覧者 ID や Cookie を送らせない。画面（静的アセット）は Worker を通らないので、
    // ゾーンの「Always Use HTTPS」も有効にしておく（README の手順を参照）
    if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    // フェイクのカレンダーとログインは、誤って本番で有効にしても動かないようにする
    if (env.CALENDAR_SOURCE === 'fake' && !isLocalHost(url.hostname)) {
      return new Response('CALENDAR_SOURCE=fake はローカル開発専用です', { status: 500 });
    }
    const services = await buildServices(env);
    return createApp(services).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
