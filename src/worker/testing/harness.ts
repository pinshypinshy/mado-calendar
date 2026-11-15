// テスト用の組み立て。本番と同じ assembleServices を使い、外部とやり取りする部分だけを差し替える。
// - D1：wrangler の getPlatformProxy で、ローカルの D1（メモリ上）を使う
// - 時計：手で進められる
// - 乱数：決まった順に値を返す
// - カレンダー・OAuth：adapters/fake.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { createD1Repositories } from '../adapters/d1';
import { FakeCalendarSource, FakeOAuthProvider } from '../adapters/fake';
import { base64url } from '../lib/encoding';
import { createSecretBox } from '../adapters/runtime';
import { assembleServices, type Services } from '../container';
import { createApp } from '../http/app';
import type { CalendarSource, Clock, OAuthProvider, Random, RepositoryFactory } from '../ports';

/** 運営者（最初のオーナー） */
export const OPERATOR_EMAIL = 'owner@example.com';
/** テスト専用の鍵（32バイトの0） */
export const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));

export class ManualClock implements Clock {
  constructor(public current: number) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/** 呼ばれるたびに異なる値を返すが、毎回のテストで同じ並びになる乱数 */
export class SequenceRandom implements Random {
  private counter = 0;
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (this.counter * 31 + i * 7 + 13) % 251;
    this.counter++;
    return out;
  }
  token(): string {
    return base64url(this.bytes(32));
  }
}

export interface TestDb {
  db: D1Database;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** テストファイルごとに1回作る。テストごとに reset() で中身を消す */
export async function createTestDb(): Promise<TestDb> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'wrangler.jsonc', persist: false });
  const db = proxy.env.DB;
  const dir = 'migrations';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of splitSql(readFileSync(join(dir, file), 'utf8'))) await db.prepare(stmt).run();
  }
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .all<{ name: string }>();
  const tables = results.map((r) => r.name);
  return {
    db,
    async reset() {
      await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
    },
    dispose: () => proxy.dispose(),
  };
}

function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface TestContext {
  services: Services;
  app: ReturnType<typeof createApp>;
  repos: RepositoryFactory;
  clock: ManualClock;
  source: FakeCalendarSource;
}

export async function createTestContext(
  db: D1Database,
  opts: { now?: string; oauth?: OAuthProvider; source?: CalendarSource } = {},
): Promise<TestContext> {
  const clock = new ManualClock(Date.parse(opts.now ?? '2026-11-16T12:00:00+09:00'));
  const random = new SequenceRandom();
  const repos = createD1Repositories(db);
  const source = new FakeCalendarSource();
  const services = assembleServices({
    mode: 'fake',
    repos,
    clock,
    random,
    secretBox: await createSecretBox(TEST_KEY, random),
    oauth: opts.oauth ?? new FakeOAuthProvider(OPERATOR_EMAIL),
    operatorEmail: OPERATOR_EMAIL,
    createCalendarSource: () => opts.source ?? source,
  });
  return { services, app: createApp(services), repos, clock, source };
}

/** Cookie を覚えておき、次のリクエストに付ける簡単なクライアント */
export class TestClient {
  readonly cookies = new Map<string, string>();
  lastSetCookies: string[] = [];
  /**
   * 閲覧者の API（/api/viewer/me・events・settings）に付ける ?v=。
   * joinWith で参加すると、その閲覧者になる。パスに v= を書いた場合はそちらを使う
   */
  viewerId: string | null = null;

  constructor(
    private readonly app: ReturnType<typeof createApp>,
    readonly origin = 'https://mado-cal.example.com',
  ) {}

  async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...init.headers };
    if (this.cookies.size > 0) headers['Cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const method = init.method ?? 'GET';
    if (this.viewerId && /^\/api\/viewer\/(me|events|settings)/.test(path) && !/[?&]v=/.test(path)) {
      path = `${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(this.viewerId)}`;
    }
    if (method !== 'GET' && !('Origin' in headers)) headers['Origin'] = this.origin;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.app.request(`${this.origin}${path}`, {
      method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    this.lastSetCookies = res.headers.getSetCookie();
    for (const c of this.lastSetCookies) {
      const [pair] = c.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      const value = rest.join('=');
      if (!name) continue;
      if (value === '' || /Max-Age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async json<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await this.request(path, init);
    return { status: res.status, body: (await res.json()) as T, res };
  }

  /** 閲覧者 ID で参加し、その閲覧者を選択中にする */
  async joinWith(code: string): Promise<Response> {
    const res = await this.request('/api/viewer/join', { method: 'POST', body: { code } });
    if (res.ok) this.viewerId = ((await res.clone().json()) as { viewerId: string }).viewerId;
    return res;
  }

  /** フェイクの OAuth でログインする。email を省略すると運営者 */
  async loginAs(email?: string): Promise<Response> {
    const start = await this.request(email ? `/auth/login?as=${encodeURIComponent(email)}` : '/auth/login');
    const location = start.headers.get('Location') ?? '';
    const url = new URL(location);
    return this.request(`${url.pathname}${url.search}`);
  }
}
