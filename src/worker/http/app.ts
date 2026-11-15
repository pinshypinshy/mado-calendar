// HTTP のルーティング。サービスを受け取って Hono のアプリを作る。
// 画面（静的アセット）は wrangler.jsonc の assets で配信し、/api/* と /auth/* だけがここに来る。
//
// オーナー間のデータの分離（要件 7.6）：
// - 管理画面の API は、ログインしているオーナーの OwnerServices だけを使う（c.get('os')）。
// - 閲覧者の API は、端末が参加している閲覧者の中から ?v= で選び、その閲覧者のオーナーの OwnerServices だけを使う。

import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  AddOwnerRequest,
  AdminMe,
  CopySettingsRequest,
  CreateViewerRequest,
  JoinRequest,
  JoinResponse,
  MembershipsResponse,
  OverrideLevel,
  RenameLabelRequest,
  SelectCalendarsRequest,
  SelectMembershipRequest,
  SetOverrideRequest,
  SetRuleRequest,
  UpdateProfileRequest,
  UpdateViewerRequest,
  ViewerSettingsRequest,
} from '../../shared/api';
import { isDateStr } from '../../shared/time';
import type { OwnerServices, Services } from '../container';
import { AppError } from '../errors';
import type { OwnerRecord, ViewerRecord } from '../ports';
import { validateRange } from '../services/feed';
import { OAUTH_STATE_TTL_SECONDS } from '../services/ownerAuth';
import { MAX_MEMBERSHIPS, type Membership } from '../services/viewerAccess';

export const COOKIE = {
  /** 閲覧者のセッションのトークン。複数の参加を「.」でつないで入れる（参加した順） */
  viewer: 'mado_v',
  /** 閲覧者が最後に選んだオーナー（閲覧者の ID） */
  viewerCurrent: 'mado_vc',
  owner: 'mado_a',
  oauth: 'mado_oauth',
} as const;

type Env = {
  Variables: {
    memberships: Membership[];
    viewer: ViewerRecord;
    owner: OwnerRecord;
    isOperator: boolean;
    os: OwnerServices;
  };
};

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

  /** 端末が参加している閲覧者を Cookie から取り出す。無効になった参加は Cookie から外す */
  const requireMemberships: MiddlewareHandler<Env> = async (c, next) => {
    const tokens = parseTokens(getCookie(c, COOKIE.viewer));
    const memberships = tokens.length > 0 ? await s.viewerAccess.memberships(tokens) : [];
    if (memberships.length === 0) {
      if (tokens.length > 0) deleteCookie(c, COOKIE.viewer, { path: '/' });
      return c.json({ error: 'unauthorized', message: '参加していません' }, 401);
    }
    // 無効な参加を外したとき、または（1日1回まで）期限を延長するときに Cookie を発行し直す（要件 7.3）
    const changed = memberships.length !== tokens.length || memberships.some((m, i) => m.token !== tokens[i]);
    if (changed || memberships.some((m) => m.renewed)) {
      setSessionCookie(c, COOKIE.viewer, serializeTokens(memberships.map((m) => m.token)), s.viewerAccess.sessionMaxAgeSeconds());
    }
    c.set('memberships', memberships);
    await next();
  };

  /** ?v= で指定した閲覧者として振る舞う。端末が参加していない閲覧者なら 404 */
  const requireViewer: MiddlewareHandler<Env> = async (c, next) => {
    const v = c.req.query('v');
    const m = c.get('memberships').find((x) => x.viewer.id === v);
    if (!m) return c.json({ error: 'not_found', message: '参加していない閲覧者です' }, 404);
    c.set('viewer', m.viewer);
    c.set('os', s.forOwner(m.viewer.ownerId));
    await next();
  };

  app.post('/api/viewer/join', async (c) => {
    const body = await readJson<JoinRequest>(c);
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const r = await s.viewerAccess.join(String(body.code ?? ''), ip);
    // すでに参加している閲覧者に新しい参加を足す（要件 4.1）。同じ閲覧者の古いトークンは外す
    const existing = await s.viewerAccess.memberships(parseTokens(getCookie(c, COOKIE.viewer)));
    const kept = existing.filter((m) => m.viewer.id !== r.viewer.id).map((m) => m.token);
    if (kept.length >= MAX_MEMBERSHIPS) {
      throw new AppError('bad_request', `この端末で参加できるのは${MAX_MEMBERSHIPS}件までです`);
    }
    setSessionCookie(c, COOKIE.viewer, serializeTokens([...kept, r.token]), s.viewerAccess.sessionMaxAgeSeconds());
    setSessionCookie(c, COOKIE.viewerCurrent, r.viewer.id, s.viewerAccess.sessionMaxAgeSeconds());
    return c.json({ viewerId: r.viewer.id } satisfies JoinResponse);
  });

  app.get('/api/viewer/memberships', requireMemberships, (c) => {
    const memberships = c.get('memberships');
    const saved = getCookie(c, COOKIE.viewerCurrent);
    // 最後に選んだオーナーを表示できなければ、最初に参加したオーナー（要件 4.6）
    const current = memberships.find((m) => m.viewer.id === saved) ?? memberships[0]!;
    return c.json({
      memberships: memberships.map((m) => ({ viewerId: m.viewer.id, ownerName: m.ownerName })),
      current: current.viewer.id,
    } satisfies MembershipsResponse);
  });

  app.put('/api/viewer/current', requireMemberships, async (c) => {
    const body = await readJson<SelectMembershipRequest>(c);
    if (!c.get('memberships').some((m) => m.viewer.id === body.viewerId)) {
      throw new AppError('not_found', '参加していない閲覧者です');
    }
    setSessionCookie(c, COOKIE.viewerCurrent, String(body.viewerId), s.viewerAccess.sessionMaxAgeSeconds());
    return c.json({ ok: true });
  });

  /** この端末の参加を1つ外す（要件 4.6）。選択中だったら選択も消し、残りの参加の最初のものを表示させる */
  app.delete('/api/viewer/memberships/:viewerId', requireMemberships, async (c) => {
    const memberships = c.get('memberships');
    const leaving = memberships.find((m) => m.viewer.id === c.req.param('viewerId'));
    if (!leaving) throw new AppError('not_found', '参加していない閲覧者です');
    await s.viewerAccess.leave(leaving.token);
    const rest = memberships.filter((m) => m !== leaving);
    // requireMemberships が Cookie を発行し直していても、あとから付けたこちらが効く
    if (rest.length === 0) deleteCookie(c, COOKIE.viewer, { path: '/' });
    else setSessionCookie(c, COOKIE.viewer, serializeTokens(rest.map((m) => m.token)), s.viewerAccess.sessionMaxAgeSeconds());
    if (getCookie(c, COOKIE.viewerCurrent) === leaving.viewer.id) deleteCookie(c, COOKIE.viewerCurrent, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/viewer/me', requireMemberships, requireViewer, (c) => c.json(c.get('os').feed.me(c.get('viewer'))));

  app.put('/api/viewer/settings', requireMemberships, requireViewer, async (c) => {
    const body = await readJson<ViewerSettingsRequest>(c);
    if (body.weekStart !== 0 && body.weekStart !== 1) throw new AppError('bad_request', 'weekStart は 0 か 1 です');
    const viewer = c.get('viewer');
    await c.get('os').feed.setWeekStart(viewer, body.weekStart);
    return c.json(c.get('os').feed.me({ ...viewer, weekStart: body.weekStart }));
  });

  app.get('/api/viewer/events', requireMemberships, requireViewer, async (c) => {
    const { from, to } = rangeQuery(c);
    const viewer = c.get('viewer');
    const res = await c
      .get('os')
      .feed.events(viewer.id, from, to, { forceRefresh: c.req.query('refresh') === '1', throttle: true });
    await s.viewerAccess.touch(viewer);
    return c.json(res);
  });

  // ---- オーナーのログイン ----

  app.get('/auth/login', async (c) => {
    const r = await s.ownerAuth.startLogin(callbackUrl(c), {
      // ログインするアカウントの候補。フェイクモードでは、これでログインするアカウントを選ぶ
      loginHint: c.req.query('as') || null,
      forceConsent: c.req.query('consent') === '1',
    });
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
      const r = await s.ownerAuth.finishLogin({
        code: c.req.query('code') ?? '',
        state: c.req.query('state') ?? '',
        stateCookie: getCookie(c, COOKIE.oauth),
        redirectUri: callbackUrl(c),
      });
      deleteCookie(c, COOKIE.oauth, { path: '/auth' });
      // リフレッシュトークンを受け取れなかったら、同意画面を出してログインし直す
      if (r.kind === 'needs_consent') return c.redirect('/auth/login?consent=1');
      setSessionCookie(c, COOKIE.owner, r.token, r.maxAgeSeconds);
      return c.redirect('/admin');
    } catch (err) {
      if (err instanceof AppError) return c.redirect(`/admin?login_error=${encodeURIComponent(err.message)}`);
      throw err;
    }
  });

  app.post('/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE.owner);
    if (token) await s.ownerAuth.logout(token);
    deleteCookie(c, COOKIE.owner, { path: '/' });
    return c.json({ ok: true });
  });

  // ---- 管理画面の API（ログインしているオーナーのデータだけを扱う） ----

  const admin = new Hono<Env>();
  admin.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE.owner);
    const auth = token ? await s.ownerAuth.authenticate(token) : null;
    if (!auth) return c.json({ error: 'unauthorized', message: 'ログインしていません' }, 401);
    c.set('owner', auth.owner);
    c.set('isOperator', auth.isOperator);
    c.set('os', s.forOwner(auth.owner.id));
    await next();
  });

  admin.get('/me', async (c) => {
    const owner = c.get('owner');
    return c.json({
      email: owner.email,
      displayName: owner.displayName,
      isOperator: c.get('isOperator'),
      calendarConnected: await s.ownerAuth.calendarConnected(owner.id),
      mode: s.mode,
    } satisfies AdminMe);
  });
  admin.put('/profile', async (c) => {
    const body = await readJson<UpdateProfileRequest>(c);
    await c.get('os').profile.setDisplayName(String(body.displayName ?? ''));
    return c.json({ ok: true });
  });

  admin.get('/calendars', async (c) => c.json(await c.get('os').adminCalendar.calendars()));
  admin.put('/calendars', async (c) => {
    const body = await readJson<SelectCalendarsRequest>(c);
    if (!Array.isArray(body.calendarIds) || !body.calendarIds.every((x) => typeof x === 'string')) {
      throw new AppError('bad_request', 'calendarIds は文字列の配列です');
    }
    await c.get('os').adminCalendar.selectCalendars(body.calendarIds);
    return c.json(await c.get('os').adminCalendar.calendars());
  });

  admin.get('/labels', async (c) => c.json(await c.get('os').adminCalendar.labels()));
  admin.put('/labels', async (c) => {
    await c.get('os').adminCalendar.renameLabel(await readRenameLabel(c));
    return c.json(await c.get('os').adminCalendar.labels());
  });

  admin.get('/viewers', async (c) => c.json(await c.get('os').adminViewers.list()));
  admin.post('/viewers', async (c) => {
    const body = await readJson<CreateViewerRequest>(c);
    return c.json(await c.get('os').adminViewers.create(String(body.displayName ?? ''), origin(c)), 201);
  });
  admin.get('/viewers/:id', async (c) => c.json(await c.get('os').adminViewers.get(c.req.param('id'), origin(c))));
  admin.patch('/viewers/:id', async (c) => {
    const body = await readJson<UpdateViewerRequest>(c);
    await c.get('os').adminViewers.update(c.req.param('id'), body);
    return c.json(await c.get('os').adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.post('/viewers/:id/disable', async (c) => {
    await c.get('os').adminViewers.disable(c.req.param('id'));
    return c.json(await c.get('os').adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.post('/viewers/:id/regenerate', async (c) => {
    await c.get('os').adminViewers.regenerate(c.req.param('id'));
    return c.json(await c.get('os').adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.delete('/viewers/:id', async (c) => {
    await c.get('os').adminViewers.delete(c.req.param('id'));
    return c.json({ ok: true });
  });
  admin.post('/viewers/:id/copy-from', async (c) => {
    const body = await readJson<CopySettingsRequest>(c);
    requireStrings(body, ['sourceViewerId']);
    await c.get('os').adminViewers.copySettings(c.req.param('id'), body.sourceViewerId);
    return c.json(await c.get('os').adminViewers.get(c.req.param('id'), origin(c)));
  });
  admin.get('/viewers/:id/rules', async (c) => c.json(await c.get('os').adminViewers.rules(c.req.param('id'))));
  admin.put('/viewers/:id/rules', async (c) => {
    const body = await readJson<SetRuleRequest>(c);
    requireStrings(body, ['calendarId', 'labelKey', 'level']);
    await c.get('os').adminViewers.setRule(c.req.param('id'), body);
    return c.json(await c.get('os').adminViewers.rules(c.req.param('id')));
  });
  // 閲覧者ごとのカテゴリ名の上書き
  admin.get('/viewers/:id/labels', async (c) => c.json(await c.get('os').adminCalendar.viewerLabels(c.req.param('id'))));
  admin.put('/viewers/:id/labels', async (c) => {
    await c.get('os').adminCalendar.renameLabelForViewer(c.req.param('id'), await readRenameLabel(c));
    return c.json(await c.get('os').adminCalendar.viewerLabels(c.req.param('id')));
  });

  // プレビュー：閲覧画面と同じ FeedService を使う（要件 3.8）
  admin.get('/viewers/:id/preview/me', async (c) => c.json(await c.get('os').feed.meFor(c.req.param('id'))));
  admin.get('/viewers/:id/preview/events', async (c) => {
    const { from, to } = rangeQuery(c);
    return c.json(
      await c
        .get('os')
        .feed.events(c.req.param('id'), from, to, { forceRefresh: c.req.query('refresh') === '1', throttle: false }),
    );
  });

  admin.get('/events', async (c) => {
    const { from, to } = rangeQuery(c);
    return c.json(await c.get('os').adminCalendar.events(from, to));
  });
  admin.put('/overrides', async (c) => {
    const body = await readJson<SetOverrideRequest>(c);
    requireStrings(body, ['viewerId', 'calendarId', 'eventKey']);
    await c.get('os').adminCalendar.setOverride({ ...body, level: (body.level ?? null) as OverrideLevel | null });
    return c.json({ ok: true });
  });
  admin.post('/cache/clear', async (c) => {
    await c.get('os').adminCalendar.clearCache();
    return c.json({ ok: true });
  });

  // ---- 運営者だけの API（要件 3.10） ----

  const operator = new Hono<Env>();
  operator.use('*', async (c, next) => {
    if (!c.get('isOperator')) return c.json({ error: 'forbidden', message: '運営者だけが使えます' }, 403);
    await next();
  });
  operator.get('/', async (c) => c.json(await s.operator.listOwners()));
  operator.post('/', async (c) => {
    const body = await readJson<AddOwnerRequest>(c);
    return c.json(await s.operator.addOwner(String(body.email ?? '')), 201);
  });
  operator.delete('/:id', async (c) => {
    await s.operator.deleteOwner(c.req.param('id'));
    return c.json({ ok: true });
  });
  admin.route('/owners', operator);

  app.route('/api/admin', admin);
  return app;
}

const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== origin(c)) {
    return c.json({ error: 'forbidden', message: '別のサイトからのリクエストは受け付けません' }, 403);
  }
  await next();
};

/** トークンは base64url なので「.」を含まない */
function parseTokens(value: string | undefined): string[] {
  return (value ?? '').split('.').filter((t) => t.length > 0);
}

function serializeTokens(tokens: string[]): string {
  return tokens.join('.');
}

function setSessionCookie(c: Context, name: string, value: string, maxAgeSeconds: number): void {
  setCookie(c, name, value, {
    path: '/',
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
  });
}

function origin(c: Context): string {
  return new URL(c.req.url).origin;
}

/** Secure を付けるか。付けないのはローカル開発（http://localhost）だけ */
function isHttps(c: Context): boolean {
  return !isLocalHost(new URL(c.req.url).hostname);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
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

async function readRenameLabel(c: Context): Promise<RenameLabelRequest> {
  const body = await readJson<RenameLabelRequest>(c);
  requireStrings(body, ['calendarId', 'labelKey']);
  const displayName = body.displayName ?? null;
  if (displayName !== null && typeof displayName !== 'string') {
    throw new AppError('bad_request', 'displayName は文字列か null です');
  }
  return { calendarId: body.calendarId, labelKey: body.labelKey, displayName };
}

function requireStrings<T, K extends keyof T>(body: Partial<T>, keys: K[]): asserts body is Partial<T> & Pick<T, K> {
  for (const k of keys) {
    if (typeof body[k] !== 'string' || body[k] === '') throw new AppError('bad_request', `${String(k)} が必要です`);
  }
}
