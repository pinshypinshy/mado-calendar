// API の結合テスト。HTTP からサービス・D1 までを通して、要件どおりに動くかを確かめる。
// Google だけはフェイク（adapters/fake.ts）に差し替えている。
// 時刻は 2026-11-16（月）12:00 JST に固定。フェイクの予定は adapters/fake.ts の templatesOn を参照。

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  AdminEventsResponse,
  AdminViewerDetail,
  AdminViewerLabel,
  EventsResponse,
  ViewerEvent,
  ViewerMe,
} from '../../shared/api';
import { FAKE_CLASS, FAKE_MAIN } from '../adapters/fake';
import { createTestContext, createTestDb, TestClient, type TestContext, type TestDb } from '../testing/harness';

let testDb: TestDb;
let ctx: TestContext;
let admin: TestClient;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.reset();
  ctx = await createTestContext(testDb.db);
  admin = new TestClient(ctx.app);
  await admin.loginAs();
});

const WEEK = '/api/viewer/events?from=2026-11-15&to=2026-11-22';

async function createViewer(name = '家族'): Promise<AdminViewerDetail> {
  const { status, body } = await admin.json<AdminViewerDetail>('/api/admin/viewers', {
    method: 'POST',
    body: { displayName: name },
  });
  expect(status).toBe(201);
  return body;
}

async function setRule(viewerId: string, calendarId: string, labelKey: string, level: string) {
  const res = await admin.request(`/api/admin/viewers/${viewerId}/rules`, {
    method: 'PUT',
    body: { calendarId, labelKey, level },
  });
  expect(res.status).toBe(200);
}

async function setOverride(viewerId: string, calendarId: string, eventKey: string, level: string | null) {
  const res = await admin.request('/api/admin/overrides', {
    method: 'PUT',
    body: { viewerId, calendarId, eventKey, level },
  });
  expect(res.status).toBe(200);
}

async function joinAs(code: string): Promise<TestClient> {
  const client = new TestClient(ctx.app);
  const res = await client.joinWith(code);
  expect(res.status).toBe(200);
  return client;
}

/** よく使う設定：対象カレンダー2つと、いくつかの表示ルール */
async function setupStandard() {
  await admin.request('/api/admin/calendars', { method: 'PUT', body: { calendarIds: [FAKE_MAIN, FAKE_CLASS] } });
  const v = await createViewer();
  await setRule(v.id, FAKE_MAIN, 'label:lbl-shift', 'detail');
  await setRule(v.id, FAKE_MAIN, 'label:lbl-private', 'category');
  await setRule(v.id, FAKE_MAIN, 'label:lbl-clinic', 'detail');
  await setRule(v.id, FAKE_CLASS, 'label:lbl-attend', 'busy');
  return v;
}

function titles(events: ViewerEvent[]): string[] {
  return events.map((e) => (e.level === 'detail' ? e.title : e.level === 'category' ? `[${e.category}]` : '(予定あり)'));
}

describe('管理者のログイン', () => {
  test('許可したメールアドレスならログインでき、Cookie は HttpOnly・Secure・SameSite=Lax', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.loginAs();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin');
    const cookie = client.lastSetCookies.find((c) => c.startsWith('mado_a='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const me = await client.json<{ email: string; calendarConnected: boolean }>('/api/admin/me');
    expect(me.body).toMatchObject({ email: 'owner@example.com', calendarConnected: true });
  });

  test('オーナーとして登録されていないアカウントではログインできない', async () => {
    const client = new TestClient(ctx.app);
    const res = await client.loginAs('someone@example.com');
    expect(decodeURIComponent(res.headers.get('Location') ?? '')).toContain('オーナーとして登録されていません');
    expect((await client.request('/api/admin/me')).status).toBe(401);
  });

  test('state が一致しなければログインできない', async () => {
    const client = new TestClient(ctx.app);
    await client.request('/auth/login');
    const res = await client.request('/auth/callback?code=fake-code&state=wrong');
    expect(decodeURIComponent(res.headers.get('Location') ?? '')).toContain('ログインの状態が一致しません');
  });

  test('ログインしていなければ管理 API は 401', async () => {
    expect((await new TestClient(ctx.app).request('/api/admin/viewers')).status).toBe(401);
  });

  test('ログアウトすると管理 API を使えなくなる', async () => {
    await admin.request('/auth/logout', { method: 'POST' });
    expect((await admin.request('/api/admin/viewers')).status).toBe(401);
  });
});

describe('CSRF 対策', () => {
  test('Origin が違う書き込みは 403', async () => {
    const res = await admin.request('/api/admin/viewers', {
      method: 'POST',
      body: { displayName: 'x' },
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});

describe('閲覧者の参加', () => {
  test('招待 URL の ID で参加でき、Cookie は長期間・HttpOnly', async () => {
    const v = await createViewer();
    expect(v.inviteUrl).toBe(`https://mado-cal.example.com/join#${v.code}`);
    const client = await joinAs(v.code);
    const cookie = client.lastSetCookies.find((c) => c.startsWith('mado_v='));
    expect(cookie).toMatch(/Max-Age=34560000/); // 400日
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    // Cookie には閲覧者 ID そのものを入れない
    expect(cookie).not.toContain(v.code.replace(/-/g, ''));
    const me = await client.json<ViewerMe>('/api/viewer/me');
    expect(me.body).toEqual({ displayName: '家族', weekStart: 0, bounds: { min: null, max: null } });
  });

  test('localhost 以外では、http でも Cookie に Secure を付ける。localhost では付けない', async () => {
    const v = await createViewer();
    const local = new TestClient(ctx.app, 'http://localhost:5173');
    await local.request('/api/viewer/join', { method: 'POST', body: { code: v.code } });
    expect(local.lastSetCookies.find((c) => c.startsWith('mado_v='))).not.toMatch(/Secure/);
    const remote = new TestClient(ctx.app, 'http://mado-cal.example.com');
    await remote.request('/api/viewer/join', { method: 'POST', body: { code: v.code } });
    expect(remote.lastSetCookies.find((c) => c.startsWith('mado_v='))).toMatch(/Secure/);
  });

  test('小文字・ハイフンなしでも参加できる', async () => {
    const v = await createViewer();
    await joinAs(v.code.replace(/-/g, '').toLowerCase());
  });

  test('間違った ID は 401、同じ IP から10回失敗すると 429', async () => {
    const client = new TestClient(ctx.app);
    const headers = { 'cf-connecting-ip': '203.0.113.1' };
    for (let i = 0; i < 10; i++) {
      const res = await client.request('/api/viewer/join', { method: 'POST', body: { code: 'WRONG' }, headers });
      expect(res.status).toBe(401);
    }
    const v = await createViewer();
    const blocked = await client.request('/api/viewer/join', { method: 'POST', body: { code: v.code }, headers });
    expect(blocked.status).toBe(429);
    // 別の IP からは参加できる
    await joinAs(v.code);
    // 10分たてば解除される
    ctx.clock.advance(10 * 60 * 1000 + 1);
    const ok = await client.request('/api/viewer/join', { method: 'POST', body: { code: v.code }, headers });
    expect(ok.status).toBe(200);
  });

  test('参加していなければ 401', async () => {
    expect((await new TestClient(ctx.app).request('/api/viewer/me')).status).toBe(401);
  });

  test('無効化すると、参加済みの端末も表示できなくなり、ID も使えなくなる', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    await admin.request(`/api/admin/viewers/${v.id}/disable`, { method: 'POST' });
    expect((await client.request('/api/viewer/me')).status).toBe(401);
    const again = await new TestClient(ctx.app).request('/api/viewer/join', { method: 'POST', body: { code: v.code } });
    expect(again.status).toBe(401);
  });

  test('再発行すると、古い ID と参加済みの端末が使えなくなり、新しい ID で参加できる', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    const { body: renewed } = await admin.json<AdminViewerDetail>(`/api/admin/viewers/${v.id}/regenerate`, {
      method: 'POST',
    });
    expect(renewed.code).not.toBe(v.code);
    expect((await client.request('/api/viewer/me')).status).toBe(401);
    const old = await new TestClient(ctx.app).request('/api/viewer/join', { method: 'POST', body: { code: v.code } });
    expect(old.status).toBe(401);
    await joinAs(renewed.code);
  });

  test('1日以上たってからアクセスすると、Cookie の期限を延長する', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    await client.request('/api/viewer/me');
    expect(client.lastSetCookies).toHaveLength(0);
    ctx.clock.advance(25 * 60 * 60 * 1000);
    await client.request('/api/viewer/me');
    expect(client.lastSetCookies.find((c) => c.startsWith('mado_v='))).toMatch(/Max-Age=34560000/);
  });

  test('最終閲覧日時を記録する', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    ctx.clock.advance(5 * 60 * 1000);
    await client.request('/api/admin/calendars'); // 閲覧者には関係ない API
    await client.request(WEEK);
    const list = await admin.json<{ id: string; lastSeenAt: number }[]>('/api/admin/viewers');
    expect(list.body[0]?.lastSeenAt).toBe(ctx.clock.now());
  });

  test('週の開始曜日を閲覧者が変えられ、サーバーに保存される', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    const res = await client.json<ViewerMe>('/api/viewer/settings', { method: 'PUT', body: { weekStart: 1 } });
    expect(res.body.weekStart).toBe(1);
    // 別の端末で参加しても引き継がれる
    const other = await joinAs(v.code);
    expect((await other.json<ViewerMe>('/api/viewer/me')).body.weekStart).toBe(1);
  });
});

describe('表示判定', () => {
  test('表示ルールに従って、見せる項目を絞る', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events)).toEqual([
      '[プライベートの予定]', // 11/15 外出：カテゴリ
      '(予定あり)', // 11/16 情報理論：予定あり
      'アルバイト', // 11/17 シフト：詳細
      '(予定あり)', // 11/18 情報理論
      'アルバイト', // 11/19
      '(予定あり)', // 11/20 情報理論
      'アルバイト', // 11/21
    ]);
    // ラベルなしのランチ、表示ルールのないデータベースの授業、対象外のカレンダー、# の歯医者は出ない
  });

  test('返すのは表示レベルに応じた項目だけ', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    const [category, busy, detail] = body.events;
    expect(Object.keys(category!).sort()).toEqual(['allDay', 'category', 'color', 'end', 'id', 'level', 'start']);
    expect(Object.keys(busy!).sort()).toEqual(['allDay', 'color', 'end', 'id', 'level', 'start']);
    expect(Object.keys(detail!).sort()).toEqual(['allDay', 'category', 'color', 'end', 'id', 'level', 'start', 'title']);
    expect(busy!.color).toBe('#9e9e9e');
    expect(detail!.color).toBe('#039be5');
    // Google の予定 ID を返さない
    expect(JSON.stringify(body)).not.toContain('shift_2026');
  });

  test('# の予定は、個別設定で「ラベルに従う」にすると # を取り除いて表示する', async () => {
    const v = await setupStandard();
    await setOverride(v.id, FAKE_MAIN, 'clinic_20261118', 'inherit');
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events)).toContain('歯医者');
  });

  test('シリーズ全体の設定と、「この回のみ」の設定', async () => {
    const v = await setupStandard();
    await setOverride(v.id, FAKE_MAIN, 'shift', 'hidden');
    await setOverride(v.id, FAKE_MAIN, 'shift_20261119', 'busy');
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events).filter((t) => t === 'アルバイト')).toHaveLength(0);
    expect(titles(body.events).filter((t) => t === '(予定あり)')).toHaveLength(4);
  });

  test('個別設定を消すと初期値に戻る', async () => {
    const v = await setupStandard();
    await setOverride(v.id, FAKE_MAIN, 'shift', 'hidden');
    await setOverride(v.id, FAKE_MAIN, 'shift', null);
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events).filter((t) => t === 'アルバイト')).toHaveLength(3);
  });

  test('カテゴリ名の上書き', async () => {
    const v = await setupStandard();
    await admin.request('/api/admin/labels', {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName: 'おでかけ' },
    });
    const client = await joinAs(v.code);
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events)[0]).toBe('[おでかけ]');
  });

  test('閲覧者ごとのカテゴリ名は、その閲覧者だけに効き、全員共通の上書きより優先する', async () => {
    const v = await setupStandard();
    const parent = await createViewer('父');
    await setRule(parent.id, FAKE_MAIN, 'label:lbl-private', 'category');
    await admin.request('/api/admin/labels', {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName: 'お出かけ' },
    });
    const res = await admin.json<AdminViewerLabel[]>(`/api/admin/viewers/${v.id}/labels`, {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName: ' 遊び ' },
    });
    expect(res.body.find((l) => l.labelKey === 'label:lbl-private')).toMatchObject({
      displayName: 'お出かけ',
      categoryName: 'お出かけ',
      viewerDisplayName: '遊び',
      viewerCategoryName: '遊び',
    });
    const a = await joinAs(v.code);
    const b = await joinAs(parent.code);
    expect(titles((await a.json<EventsResponse>(WEEK)).body.events)[0]).toBe('[遊び]');
    expect(titles((await b.json<EventsResponse>(WEEK)).body.events)[0]).toBe('[お出かけ]');
  });

  test('閲覧者ごとのカテゴリ名を空欄にすると、全員共通の名前に戻る', async () => {
    const v = await setupStandard();
    const put = (displayName: string | null) =>
      admin.json<AdminViewerLabel[]>(`/api/admin/viewers/${v.id}/labels`, {
        method: 'PUT',
        body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName },
      });
    await put('遊び');
    const res = await put('');
    expect(res.body.find((l) => l.labelKey === 'label:lbl-private')).toMatchObject({
      viewerDisplayName: null,
      viewerCategoryName: 'プライベートの予定',
    });
    const client = await joinAs(v.code);
    expect(titles((await client.json<EventsResponse>(WEEK)).body.events)[0]).toBe('[プライベートの予定]');
  });

  test('閲覧者ごとのカテゴリ名は50文字まで', async () => {
    const v = await setupStandard();
    const res = await admin.request(`/api/admin/viewers/${v.id}/labels`, {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName: 'あ'.repeat(51) },
    });
    expect(res.status).toBe(400);
  });

  test('期間制限：範囲外の予定は返さない', async () => {
    const v = await setupStandard();
    // 過去は制限なし、未来は0か月（今日まで）
    await admin.request(`/api/admin/viewers/${v.id}`, {
      method: 'PATCH',
      body: { period: { enabled: true, pastMonths: null, futureMonths: 0 } },
    });
    const client = await joinAs(v.code);
    const me = await client.json<ViewerMe>('/api/viewer/me');
    expect(me.body.bounds).toEqual({ min: null, max: '2026-11-17' });
    const { body } = await client.json<EventsResponse>(WEEK);
    expect(titles(body.events)).toEqual(['[プライベートの予定]', '(予定あり)']);
  });

  test('閲覧者ごとに見え方が違う', async () => {
    const v = await setupStandard();
    const parent = await createViewer('父');
    await setRule(parent.id, FAKE_MAIN, 'label:lbl-shift', 'busy');
    const a = await joinAs(v.code);
    const b = await joinAs(parent.code);
    expect((await a.json<EventsResponse>(WEEK)).body.events).toHaveLength(7);
    expect(titles((await b.json<EventsResponse>(WEEK)).body.events)).toEqual(['(予定あり)', '(予定あり)', '(予定あり)']);
  });

  test('期間の指定が不正なら 400', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    expect((await client.request('/api/viewer/events?from=2026-11-15&to=2027-03-01')).status).toBe(400);
    expect((await client.request('/api/viewer/events?from=x&to=y')).status).toBe(400);
  });
});

describe('キャッシュと更新ボタン', () => {
  test('5分間はキャッシュを使い、過ぎたら取り直す', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    await client.request(WEEK);
    const first = ctx.source.calls.listEvents;
    expect(first).toBe(2); // 2カレンダー × 11月
    await client.request(WEEK);
    expect(ctx.source.calls.listEvents).toBe(first);
    ctx.clock.advance(5 * 60 * 1000);
    await client.request(WEEK);
    expect(ctx.source.calls.listEvents).toBe(first + 2);
  });

  test('更新ボタンはキャッシュを使わない。5秒以内の2回目は、知らせずにキャッシュを返す', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    await client.request(WEEK);
    const before = ctx.source.calls.listEvents;
    await client.request(`${WEEK}&refresh=1`);
    expect(ctx.source.calls.listEvents).toBe(before + 2);
    ctx.clock.advance(4 * 1000);
    const r2 = await client.json<EventsResponse>(`${WEEK}&refresh=1`);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ events: expect.any(Array) });
    expect(r2.body.events).toHaveLength(7);
    expect(ctx.source.calls.listEvents).toBe(before + 2);
    ctx.clock.advance(1000);
    await client.request(`${WEEK}&refresh=1`);
    expect(ctx.source.calls.listEvents).toBe(before + 4);
  });
});

describe('管理画面', () => {
  test('プレビューは閲覧画面と同じ結果になる', async () => {
    const v = await setupStandard();
    const client = await joinAs(v.code);
    const viewerView = await client.json<EventsResponse>(WEEK);
    const preview = await admin.json<EventsResponse>(
      `/api/admin/viewers/${v.id}/preview/events?from=2026-11-15&to=2026-11-22`,
    );
    expect(preview.body).toEqual(viewerView.body);
  });

  test('予定一覧には、閲覧者ごとの個別設定と実際の表示レベルが付く', async () => {
    const v = await setupStandard();
    await setOverride(v.id, FAKE_MAIN, 'shift', 'busy');
    const { body } = await admin.json<AdminEventsResponse>('/api/admin/events?from=2026-11-17&to=2026-11-18');
    const shift = body.events.find((e) => e.eventId === 'shift_20261117');
    expect(shift).toMatchObject({ recurringEventId: 'shift', title: 'アルバイト', categoryName: 'アルバイトのシフト' });
    expect(shift?.viewers).toEqual([{ viewerId: v.id, instanceLevel: null, seriesLevel: 'busy', effective: 'busy' }]);
  });

  test('設定のコピー（閲覧者ごとのカテゴリ名を含む）', async () => {
    const v = await setupStandard();
    await setOverride(v.id, FAKE_MAIN, 'shift', 'busy');
    await admin.request(`/api/admin/viewers/${v.id}/labels`, {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-private', displayName: '遊び' },
    });
    await admin.request(`/api/admin/viewers/${v.id}`, {
      method: 'PATCH',
      body: { defaultWeekStart: 1, period: { enabled: true, pastMonths: 1, futureMonths: 3 } },
    });
    const other = await createViewer('母');
    const copied = await admin.json<AdminViewerDetail>(`/api/admin/viewers/${other.id}/copy-from`, {
      method: 'POST',
      body: { sourceViewerId: v.id },
    });
    expect(copied.body).toMatchObject({
      displayName: '母',
      defaultWeekStart: 1,
      period: { enabled: true, pastMonths: 1, futureMonths: 3 },
    });
    const rules = await admin.json<unknown[]>(`/api/admin/viewers/${other.id}/rules`);
    expect(rules.body).toHaveLength(4);
    const labels = await admin.json<AdminViewerLabel[]>(`/api/admin/viewers/${other.id}/labels`);
    expect(labels.body.find((l) => l.labelKey === 'label:lbl-private')?.viewerDisplayName).toBe('遊び');
    const a = await admin.json<EventsResponse>(`/api/admin/viewers/${v.id}/preview/events?from=2026-11-15&to=2026-11-22`);
    const b = await admin.json<EventsResponse>(
      `/api/admin/viewers/${other.id}/preview/events?from=2026-11-15&to=2026-11-22`,
    );
    expect(b.body).toEqual(a.body);
  });

  test('閲覧者 ID は管理画面でいつでも再表示できる', async () => {
    const v = await createViewer();
    const again = await admin.json<AdminViewerDetail>(`/api/admin/viewers/${v.id}`);
    expect(again.body.code).toBe(v.code);
  });

  test('閲覧者を削除すると、参加済みの端末も表示できなくなる', async () => {
    const v = await createViewer();
    const client = await joinAs(v.code);
    await admin.request(`/api/admin/viewers/${v.id}`, { method: 'DELETE' });
    expect((await client.request('/api/viewer/me')).status).toBe(401);
  });

  test('ラベルの一覧：Google のラベルとラベルなし（colorId の行は出さない）', async () => {
    await admin.request('/api/admin/calendars', { method: 'PUT', body: { calendarIds: [FAKE_MAIN] } });
    const { body } = await admin.json<{ labelKey: string; categoryName: string }[]>('/api/admin/labels');
    expect(body.map((l) => l.labelKey)).toContain('label:lbl-shift');
    expect(body.some((l) => l.labelKey.startsWith('color:'))).toBe(false);
    expect(body.at(-1)).toMatchObject({ labelKey: 'none', categoryName: 'メイン（フェイク）' });
    // 名前が空欄のラベルはカレンダー名
    expect(body.find((l) => l.labelKey === 'label:lbl-lemon')?.categoryName).toBe('メイン（フェイク）');
  });

  test('存在しないカレンダーは選べない', async () => {
    const res = await admin.request('/api/admin/calendars', { method: 'PUT', body: { calendarIds: ['nope'] } });
    expect(res.status).toBe(400);
  });
});
