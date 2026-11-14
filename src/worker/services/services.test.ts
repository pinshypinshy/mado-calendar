// サービス単体のテスト。D1 は使わず、必要なリポジトリだけをその場で作る。

import { describe, expect, test } from 'vitest';
import { FakeCalendarSource } from '../adapters/fake';
import { createSecretBox } from '../adapters/runtime';
import { OAuthRevokedError } from '../errors';
import type { CacheEntry, CacheRepository, OAuthProvider, StoredToken, TokenRepository } from '../ports';
import { ManualClock, SequenceRandom, TEST_KEY } from '../testing/harness';
import { CalendarData, monthsCovering } from './calendarData';
import { TokenProvider } from './tokenProvider';

class MemoryCache implements CacheRepository {
  readonly map = new Map<string, CacheEntry>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async put(key: string, payload: string, fetchedAt: number) {
    this.map.set(key, { payload, fetchedAt });
  }
  async deleteAll() {
    this.map.clear();
  }
}

test('monthsCovering', () => {
  const t = (s: string) => Date.parse(s);
  expect(monthsCovering(t('2026-11-29T00:00:00+09:00'), t('2026-12-06T00:00:00+09:00'))).toEqual(['2026-11-01', '2026-12-01']);
  expect(monthsCovering(t('2026-11-01T00:00:00+09:00'), t('2026-12-01T00:00:00+09:00'))).toEqual(['2026-11-01']);
});

describe('CalendarData', () => {
  function setup() {
    const clock = new ManualClock(Date.parse('2026-11-16T12:00:00+09:00'));
    const source = new FakeCalendarSource();
    const cache = new MemoryCache();
    const data = new CalendarData({
      source,
      cache,
      clock,
      selection: { list: async () => ['fake-main'], replace: async () => {} },
      labelNames: { list: async () => [], set: async () => {} },
    });
    return { clock, source, cache, data };
  }

  test('月をまたぐ期間は月ごとに取得し、重複を除く', async () => {
    const { data, source } = setup();
    const from = Date.parse('2026-11-29T00:00:00+09:00');
    const to = Date.parse('2026-12-06T00:00:00+09:00');
    const events = await data.events(['fake-main'], from, to);
    expect(source.calls.listEvents).toBe(2);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.every((e) => e.end > from && e.start < to)).toBe(true);
  });

  test('Google の取得に失敗しても、古いキャッシュがあればそれを返す', async () => {
    const { data, source, clock } = setup();
    const from = Date.parse('2026-11-16T00:00:00+09:00');
    const to = Date.parse('2026-11-17T00:00:00+09:00');
    const first = await data.events(['fake-main'], from, to);
    clock.advance(60 * 60 * 1000);
    source.listEvents = async () => {
      throw new Error('google down');
    };
    expect(await data.events(['fake-main'], from, to)).toEqual(first);
  });

  test('更新ボタン（force）のときは、取得に失敗したら古いキャッシュで代替せずエラーにする', async () => {
    const { data, source } = setup();
    await data.events(['fake-main'], 0, 1);
    source.listEvents = async () => {
      throw new Error('google down');
    };
    await expect(data.events(['fake-main'], 0, 1, { force: true })).rejects.toThrow('google down');
  });

  test('キャッシュがなく取得にも失敗したらエラー', async () => {
    const { data, source } = setup();
    source.listEvents = async () => {
      throw new Error('google down');
    };
    await expect(data.events(['fake-main'], 0, 1)).rejects.toThrow('google down');
  });
});

describe('TokenProvider', () => {
  async function setup(refresh: OAuthProvider['refresh']) {
    const clock = new ManualClock(1_000_000);
    const random = new SequenceRandom();
    const secretBox = await createSecretBox(TEST_KEY, random);
    let stored: StoredToken | null = {
      refreshTokenEnc: await secretBox.encrypt('refresh'),
      accessTokenEnc: await secretBox.encrypt('old-access'),
      accessExpiresAt: clock.now() + 10 * 60 * 1000,
      scope: 'x',
      updatedAt: 0,
    };
    const tokens: TokenRepository = {
      get: async () => stored,
      save: async (t) => {
        stored = t;
      },
      clear: async () => {
        stored = null;
      },
    };
    const oauth = { calendarScope: 'x', refresh, authorizationUrl: () => '', exchangeCode: async () => { throw new Error(); } } as OAuthProvider;
    return { clock, tokens, provider: new TokenProvider({ tokens, oauth, secretBox, clock }) };
  }

  test('期限内ならそのまま、期限が近ければ取り直す', async () => {
    let calls = 0;
    const { clock, provider } = await setup(async (rt) => {
      calls++;
      expect(rt).toBe('refresh');
      return { accessToken: 'new-access', expiresIn: 3600 };
    });
    expect(await provider.accessToken()).toBe('old-access');
    clock.advance(9.5 * 60 * 1000);
    expect(await provider.accessToken()).toBe('new-access');
    expect(await provider.accessToken()).toBe('new-access');
    expect(calls).toBe(1);
  });

  test('リフレッシュトークンが失効していたら calendar_not_connected にし、保存していたトークンを消す', async () => {
    const { clock, provider, tokens } = await setup(async () => {
      throw new OAuthRevokedError();
    });
    clock.advance(60 * 60 * 1000);
    await expect(provider.accessToken()).rejects.toMatchObject({ code: 'calendar_not_connected' });
    expect(await tokens.get()).toBeNull();
  });

  test('並行して呼ばれても、取り直しは1回', async () => {
    let calls = 0;
    const { clock, provider } = await setup(async () => {
      calls++;
      return { accessToken: 'new-access', expiresIn: 3600 };
    });
    clock.advance(60 * 60 * 1000);
    const tokens = await Promise.all([provider.accessToken(), provider.accessToken(), provider.accessToken()]);
    expect(tokens).toEqual(['new-access', 'new-access', 'new-access']);
    expect(calls).toBe(1);
  });
});

describe('SecretBox', () => {
  test('暗号化して戻せる。毎回違う暗号文になる。ハッシュは同じ値になる', async () => {
    const box = await createSecretBox(TEST_KEY, { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)), token: () => '' });
    const a = await box.encrypt('ABCD');
    const b = await box.encrypt('ABCD');
    expect(a).not.toBe(b);
    expect(await box.decrypt(a)).toBe('ABCD');
    expect(await box.hash('ABCD')).toBe(await box.hash('ABCD'));
    expect(await box.hash('ABCD')).not.toBe(await box.hash('ABCE'));
  });

  test('鍵が違えば復号できない', async () => {
    const r = { bytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)), token: () => '' };
    const box1 = await createSecretBox(TEST_KEY, r);
    const box2 = await createSecretBox(btoa(String.fromCharCode(...new Uint8Array(32).fill(1))), r);
    await expect(box2.decrypt(await box1.encrypt('x'))).rejects.toThrow();
  });

  test('鍵の長さが違えばエラー', async () => {
    await expect(createSecretBox(btoa('short'), new SequenceRandom())).rejects.toThrow('32バイト');
  });
});
