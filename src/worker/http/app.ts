// HTTP のルーティング。サービスを受け取って Hono のアプリを作る。
// 画面（静的アセット）は wrangler.jsonc の assets で配信し、/api/* と /auth/* だけがここに来る。

import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  AdminMe,
  CopySettingsRequest,
  CreateViewerRequest,
  JoinRequest,
  OverrideLevel,
  RenameLabelRequest,
  SelectCalendarsRequest,
  SetOverrideRequest,
  SetRuleRequest,
  UpdateViewerRequest,
  ViewerSettingsRequest,
} from '../../shared/api';
import { isDateStr } from '../../shared/time';
import type { Services } from '../container';
import { AppError } from '../errors';
import type { ViewerRecord } from '../ports';
import { OAUTH_STATE_TTL_SECONDS } from '../services/adminAuth';
import { validateRange } from '../services/feed';

export const COOKIE = {
  viewer: 'mado_v',
  admin: 'mado_a',
  oauth: 'mado_oauth',
} as const;

type Env = { Variables: { viewer: ViewerRecord; adminEmail: string } };

export function createApp(s: Services): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.retryAfter) c.header('Retry-After', String(err.retryAfter));
      return c.json({ error: err.code, message: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(err);
    return c.json({ error: 'internal', message: 'サーバーでエラーが発生しました' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found', message: '見つかりません' }, 404));

  // API の応答はキャッシュさせない
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  // 書き込みのリクエストは、同じオリジンの画面から来たものだけを受け付ける（CSRF 対策。Cookie の SameSite=Lax と併用）
  app.use('/api/*', sameOrigin);
  app.use('/auth/logout', sameOrigin);

  // ---- 閲覧者 ----

  const requireViewer: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, COOKIE.viewer);
    const auth = token ? await s.viewerAccess.authenticate(token) : null;
    if (!token || !auth) {
      if (token) deleteCookie(c, COOKIE.viewer, { path: '/' });
      return c.json({ error: 'unauthorized', message: '参加していません' }, 401);
    }
    // アクセスのたびに（1日1回まで）Cookie の期限を延長する（要件 7.3）
    if (auth.renewed) setSessionCookie(c, COOKIE.viewer, token, s.viewerAccess.sessionMaxAgeSeconds());
    c.set('viewer', auth.viewer);
    await next();
  };

  app.post('/api/viewer/join', async (c) => {
    const body = await readJson<JoinRequest>(c);
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const r = await s.viewerAccess.join(String(body.code ?? ''), ip);
    setSessionCookie(c, COOKIE.viewer, r.token, r.maxAgeSeconds);
    return c.json({ ok: true });
  });

  app.get('/api/viewer/me', requireViewer, (c) => c.json(s.feed.me(c.get('viewer'))));

  app.put('/api/viewer/settings', requireViewer, async (c) => {
    const body = await readJson<ViewerSettingsRequest>(c);
    if (body.weekStart !== 0 && body.weekStart !== 1) throw new AppError('bad_request', 'weekStart は 0 か 1 です');
    const viewer = c.get('viewer');
    await s.feed.setWeekStart(viewer, body.weekStart);
    return c.json(s.feed.me({ ...viewer, weekStart: body.weekStart }));
  });

  app.get('/api/viewer/events', requireViewer, async (c) => {
    const { from, to } = rangeQuery(c);
    const viewer = c.get('viewer');
    const res = await s.feed.events(viewer.id, from, to, { forceRefresh: c.req.query('refresh') === '1', throttle: true });
    await s.viewerAccess.touch(viewer);
    return c.json(res);
  });

  // ---- 管理者のログイン ----

  app.get('/auth/login', async (c) => {
    const r = await s.adminAuth.startLogin(callbackUrl(c));
    setCookie(c, COOKIE.oauth, r.stateCookie, {
      path: '/auth',
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Lax',
      maxAge: OAUTH_STATE_TTL_SECONDS,
    });
    return c.redirect(r.url);
  });

  app.get('/auth/callback', async (c) => {
    const error = c.req.query('error');
    if (error) return c.redirect(`/admin?login_error=${encodeURIComponent(`Google でのログインが中止されました（${error}）`)}`);
    try {
      const r = await s.adminAuth.finishLogin({
        code: c.req.query('code') ?? '',
        state: c.req.query('state') ?? '',
        stateCookie: getCookie(c, COOKIE.oauth),
        redirectUri: callbackUrl(c),
      });
      deleteCookie(c, COOKIE.oauth, { path: '/auth' });
      setSessionCookie(c, COOKIE.admin, r.token, r.maxAgeSeconds);
      return c.redirect('/admin');
    } catch (err) {
      if (err instanceof AppError) return c.redirect(`/admin?login_error=${encodeURIComponent(err.message)}`);
      throw err;
    }
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE.admin);
    if (token) await s.adminAuth.logout(token);
    deleteCookie(c, COOKIE.admin, { path: '/' });
    return c.json({ ok: true });
  });

  // ---- 管理画面の API ----

  const admin = new Hono<Env>();
  admin.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE.admin);
    const auth = token ? await s.adminAuth.authenticate(token) : null;
    if (!auth) return c.json({ error: 'unauthorized', message: 'ログインしていません' }, 401);
    c.set('adminEmail', auth.email);
    await next();
  });

  admin.get('/me', async (c) =>
    c.json({
      email: c.get('adminEmail'),
      calendarConnected: await s.adminAuth.calendarConnected(),
      mode: s.mode,
    } satisfies AdminMe),
  );

  admin.get('/calendars', async (c) => c.json(await s.adminCalendar.calendars()));
  admin.put('/calendars', async (c) => {
    const body = await readJson<SelectCalendarsRequest>(c);
    if (!Array.isArray(body.calendarIds) || !body.calendarIds.every((x) => typeof x === 'string')) {
      throw new AppError('bad_request', 'calendarIds は文字列の配列です');
    }
    await s.adminCalendar.selectCalendars(body.calendarIds);
    return c.json(await s.adminCalendar.calendars());
  });

  admin.get('/labels', async (c) => c.json(await s.adminCalendar.labels()));
  admin.put('/labels', async (c) => {
    const body = await readJson<RenameLabelRequest>(c);
    requireStrings(body, ['calendarId', 'labelKey']);
    const displayName = body.displayName ?? null;
    if (displayName !== null && typeof displayName !== 'string') {
      throw new AppError('bad_request', 'displayName は文字列か null です');
    }
    await s.adminCalendar.renameLabel({ calendarId: body.calendarId, labelKey: body.labelKey, displayName });
    return c.json(await s.adminCalendar.labels());
  });

  admin.get('/viewers', async (c) => c.json(await s.adminViewers.list()));
  admin.post('/viewers', async (c) => {
    const body = await readJson<CreateViewerRequest>(c);
    return c.json(await s.adminViewers.create(String(body.displayName ?? ''), origin(c)), 201);
  });
  admin.get('/viewers/:id', async (c) => c.json(await s.adminViewers.get(c.req.param('id'), origin(c))));
  admin.patch('/viewers/:id', async (c) => {
    const body = await readJson<UpdateViewerRequest>(c);
    await s.adminViewers.update(c.req.param('id'), body);
    return c.json(await s.adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.post('/viewers/:id/disable', async (c) => {
    await s.adminViewers.disable(c.req.param('id'));
    return c.json(await s.adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.post('/viewers/:id/regenerate', async (c) => {
    await s.adminViewers.regenerate(c.req.param('id'));
    return c.json(await s.adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.delete('/viewers/:id', async (c) => {
    await s.adminViewers.delete(c.req.param('id'));
    return c.json({ ok: true });
  });
  admin.post('/viewers/:id/copy-from', async (c) => {
    const body = await readJson<CopySettingsRequest>(c);
    requireStrings(body, ['sourceViewerId']);
    await s.adminViewers.copySettings(c.req.param('id'), body.sourceViewerId);
    return c.json(await s.adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.get('/viewers/:id/rules', async (c) => c.json(await s.adminViewers.rules(c.req.param('id'))));
  admin.put('/viewers/:id/rules', async (c) => {
    const body = await readJson<SetRuleRequest>(c);
    requireStrings(body, ['calendarId', 'labelKey', 'level']);
    await s.adminViewers.setRule(c.req.param('id'), body);
    return c.json(await s.adminViewers.rules(c.req.param('id')));
  });

  // プレビュー：閲覧画面と同じ FeedService を使う（要件 3.8）
  admin.get('/viewers/:id/preview/me', async (c) => c.json(await s.feed.meFor(c.req.param('id'))));
  admin.get('/viewers/:id/preview/events', async (c) => {
    const { from, to } = rangeQuery(c);
    return c.json(
      await s.feed.events(c.req.param('id'), from, to, { forceRefresh: c.req.query('refresh') === '1', throttle: false }),
    );
  });

  admin.get('/events', async (c) => {
    const { from, to } = rangeQuery(c);
    return c.json(await s.adminCalendar.events(from, to));
  });
  admin.put('/overrides', async (c) => {
    const body = await readJson<SetOverrideRequest>(c);
    requireStrings(body, ['viewerId', 'calendarId', 'eventKey']);
    await s.adminCalendar.setOverride({ ...body, level: (body.level ?? null) as OverrideLevel | null });
    return c.json({ ok: true });
  });
  admin.post('/cache/clear', async (c) => {
    await s.adminCalendar.clearCache();
    return c.json({ ok: true });
  });

  app.route('/api/admin', admin);
  return app;
}

const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== origin(c)) {
    return c.json({ error: 'forbidden', message: '別のサイトからのリクエストは受け付けません' }, 403);
  }
  await next();
};

function setSessionCookie(c: Context, name: string, value: string, maxAgeSeconds: number): void {
  setCookie(c, name, value, {
    path: '/',
    httpOnly: true,
    // ローカル開発（http://localhost）でも動くよう、https のときだけ Secure を付ける
    secure: isHttps(c),
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
  });
}

function origin(c: Context): string {
  return new URL(c.req.url).origin;
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function callbackUrl(c: Context): string {
  return `${origin(c)}/auth/callback`;
}

function rangeQuery(c: Context): { from: string; to: string } {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  validateRange(from, to, isDateStr);
  return { from, to };
}

async function readJson<T>(c: Context): Promise<Partial<T>> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
    return body as Partial<T>;
  } catch {
    throw new AppError('bad_request', 'リクエストの本文が JSON のオブジェクトではありません');
  }
}

function requireStrings<T, K extends keyof T>(body: Partial<T>, keys: K[]): asserts body is Partial<T> & Pick<T, K> {
  for (const k of keys) {
    if (typeof body[k] !== 'string' || body[k] === '') throw new AppError('bad_request', `${String(k)} が必要です`);
  }
}
