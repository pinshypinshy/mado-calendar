import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppError, OAuthRevokedError } from '../errors';
import { base64url } from '../lib/encoding';
import { GoogleCalendarSource, GoogleOAuthProvider, normalizeGoogleEvent } from './google';

function fakeFetch(handler: (url: URL, init?: RequestInit) => unknown, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return new Response(JSON.stringify(handler(url, init)), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe('normalizeGoogleEvent', () => {
  test('時刻のある予定', () => {
    const e = normalizeGoogleEvent('c', {
      id: 'x_20261117T080000Z',
      recurringEventId: 'x',
      summary: 'シフト',
      start: { dateTime: '2026-11-17T17:00:00+09:00' },
      end: { dateTime: '2026-11-17T22:00:00+09:00' },
      colorId: '7',
      eventLabelId: 'L1',
    });
    expect(e).toEqual({
      calendarId: 'c',
      id: 'x_20261117T080000Z',
      recurringEventId: 'x',
      title: 'シフト',
      start: Date.parse('2026-11-17T08:00:00Z'),
      end: Date.parse('2026-11-17T13:00:00Z'),
      allDay: false,
      eventLabelId: 'L1',
      colorId: '7',
    });
  });
  test('終日の予定は JST の 0:00 から', () => {
    const e = normalizeGoogleEvent('c', { id: 'a', start: { date: '2026-11-24' }, end: { date: '2026-11-27' } });
    expect(e).toMatchObject({
      allDay: true,
      start: Date.parse('2026-11-24T00:00:00+09:00'),
      end: Date.parse('2026-11-27T00:00:00+09:00'),
      title: '',
      eventLabelId: null,
      colorId: null,
    });
  });
  test('キャンセルされた予定は除く', () => {
    expect(normalizeGoogleEvent('c', { id: 'a', status: 'cancelled' })).toBeNull();
  });
});

describe('GoogleCalendarSource', () => {
  test('予定の取得：繰り返しを展開し、説明欄などを取らず、ページ送りする', async () => {
    let page = 0;
    const { fn, calls } = fakeFetch(() => {
      page++;
      return page === 1
        ? { items: [{ id: '1', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }], nextPageToken: 'p2' }
        : { items: [{ id: '2', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }] };
    });
    const source = new GoogleCalendarSource(async () => 'tok', fn);
    const events = await source.listEvents('a@b', 0, 1000);
    expect(events.map((e) => e.id)).toEqual(['1', '2']);
    const first = calls[0]!;
    expect(first.url.pathname).toBe('/calendar/v3/calendars/a%40b/events');
    expect(first.url.searchParams.get('singleEvents')).toBe('true');
    expect(first.url.searchParams.get('fields')).not.toMatch(/description|location|attendees|hangoutLink|attachments/);
    expect(new Headers(first.init?.headers).get('Authorization')).toBe('Bearer tok');
    expect(calls[1]!.url.searchParams.get('pageToken')).toBe('p2');
  });

  test('ラベルの取得：labelProperties.eventLabels', async () => {
    const { fn } = fakeFetch(() => ({
      labelProperties: { eventLabels: [{ id: 'L1', backgroundColor: '#123456' }, { id: 'L2', name: 'バイト', backgroundColor: '#000000' }] },
    }));
    const labels = await new GoogleCalendarSource(async () => 't', fn).listLabels('c');
    expect(labels).toEqual([
      { id: 'L1', name: '', color: '#123456' },
      { id: 'L2', name: 'バイト', color: '#000000' },
    ]);
  });

  test('labelProperties がなければ空', async () => {
    const { fn } = fakeFetch(() => ({}));
    expect(await new GoogleCalendarSource(async () => 't', fn).listLabels('c')).toEqual([]);
  });

  test('エラーは AppError(upstream_error)', async () => {
    const { fn } = fakeFetch(() => ({ error: 'x' }), 500);
    await expect(new GoogleCalendarSource(async () => 't', fn).listCalendars()).rejects.toMatchObject({
      code: 'upstream_error',
    });
  });
});

describe('GoogleOAuthProvider', () => {
  const idToken = (claims: object) => `x.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}.sig`;

  test('認可 URL：読み取り専用のスコープ、PKCE、オフラインアクセス', () => {
    const url = new URL(
      new GoogleOAuthProvider('cid', 'sec').authorizationUrl({
        redirectUri: 'https://x/auth/callback',
        state: 's',
        codeChallenge: 'cc',
        forceConsent: true,
        loginHint: 'owner@example.com',
      }),
    );
    expect(url.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toContain('consent');
    expect(url.searchParams.get('login_hint')).toBe('owner@example.com');
  });

  test('コードの交換：ID トークンからメールアドレスを取り出す', async () => {
    const { fn } = fakeFetch(() => ({
      access_token: 'at',
      expires_in: 3600,
      refresh_token: 'rt',
      scope: 's',
      id_token: idToken({ iss: 'https://accounts.google.com', aud: 'cid', email: 'a@b.c', email_verified: true }),
    }));
    const r = await new GoogleOAuthProvider('cid', 'sec', fn).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' });
    expect(r).toEqual({ accessToken: 'at', expiresIn: 3600, refreshToken: 'rt', scope: 's', email: 'a@b.c', emailVerified: true });
  });

  test('宛先の違う ID トークンは拒否する', async () => {
    const { fn } = fakeFetch(() => ({
      access_token: 'at',
      expires_in: 3600,
      id_token: idToken({ iss: 'https://accounts.google.com', aud: 'other', email: 'a@b.c', email_verified: true }),
    }));
    await expect(
      new GoogleOAuthProvider('cid', 'sec', fn).exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  test('リフレッシュトークンが失効していたら OAuthRevokedError', async () => {
    const { fn } = fakeFetch(() => ({ error: 'invalid_grant' }), 400);
    await expect(new GoogleOAuthProvider('cid', 'sec', fn).refresh('rt')).rejects.toBeInstanceOf(OAuthRevokedError);
  });
});

describe('既定の fetch の呼び方', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Workers では、グローバルの fetch を別のオブジェクトのメソッドとして呼ぶと Illegal invocation になる。
  // Node ではこのエラーが起きないので、this を確かめる偽の fetch で同じ条件を作る。
  function strictFetch(body: unknown) {
    return function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
  }

  test('GoogleOAuthProvider', async () => {
    vi.stubGlobal('fetch', strictFetch({ error: 'invalid_grant' }));
    await expect(new GoogleOAuthProvider('cid', 'sec').refresh('rt')).resolves.toBeDefined();
  });

  test('GoogleCalendarSource', async () => {
    vi.stubGlobal('fetch', strictFetch({ items: [] }));
    await expect(new GoogleCalendarSource(async () => 't').listCalendars()).resolves.toEqual([]);
  });
});
