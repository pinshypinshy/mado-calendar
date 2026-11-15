// 複数オーナーの結合テスト（要件 3.9、3.10、4.6、7.6）。
// オーナー A（運営者）とオーナー B（運営者が追加）を用意し、互いのデータに届かないことを確かめる。

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  AdminEventsResponse,
  AdminMe,
  AdminViewerDetail,
  AdminViewerSummary,
  EventsResponse,
  MembershipsResponse,
  OwnerSummary,
} from '../../shared/api';
import { FAKE_CLASS, FAKE_MAIN } from '../adapters/fake';
import { createTestContext, createTestDb, TestClient, type TestContext, type TestDb } from '../testing/harness';

const OWNER_B = 'papa@example.com';
const WEEK = '/api/viewer/events?from=2026-11-15&to=2026-11-22';

let testDb: TestDb;
let ctx: TestContext;
/** 運営者（オーナー A） */
let a: TestClient;
/** オーナー B */
let b: TestClient;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.reset();
  ctx = await createTestContext(testDb.db);
  a = new TestClient(ctx.app);
  await a.loginAs();
  expect((await a.request('/api/admin/owners', { method: 'POST', body: { email: OWNER_B } })).status).toBe(201);
  b = new TestClient(ctx.app);
  await b.loginAs(OWNER_B);
  expect((await b.request('/api/admin/me')).status).toBe(200);
});

async function createViewer(owner: TestClient, name: string): Promise<AdminViewerDetail> {
  const res = await owner.json<AdminViewerDetail>('/api/admin/viewers', { method: 'POST', body: { displayName: name } });
  expect(res.status).toBe(201);
  return res.body;
}

async function setup(owner: TestClient, calendars: string[], rules: [string, string, string][]) {
  await owner.request('/api/admin/calendars', { method: 'PUT', body: { calendarIds: calendars } });
  const v = await createViewer(owner, '母');
  for (const [calendarId, labelKey, level] of rules) {
    await owner.request(`/api/admin/viewers/${v.id}/rules`, { method: 'PUT', body: { calendarId, labelKey, level } });
  }
  return v;
}

describe('運営者によるオーナーの管理', () => {
  test('運営者は自分を含むオーナーの一覧を見られ、運営者の印が付く', async () => {
    const { body } = await a.json<OwnerSummary[]>('/api/admin/owners');
    expect(body.map((o) => [o.email, o.isOperator])).toEqual([
      ['owner@example.com', true],
      [OWNER_B, false],
    ]);
    expect(body[1]?.lastLoginAt).not.toBeNull();
  });

  test('運営者でないオーナーは、オーナーの管理の API を使えない', async () => {
    expect((await b.request('/api/admin/owners')).status).toBe(403);
    expect((await b.request('/api/admin/owners', { method: 'POST', body: { email: 'x@example.com' } })).status).toBe(403);
    const me = await b.json<AdminMe>('/api/admin/me');
    expect(me.body).toMatchObject({ email: OWNER_B, isOperator: false });
  });

  test('同じアドレスは二重に登録できない。形式の正しくないアドレスも登録できない', async () => {
    expect((await a.request('/api/admin/owners', { method: 'POST', body: { email: 'PAPA@example.com' } })).status).toBe(400);
    expect((await a.request('/api/admin/owners', { method: 'POST', body: { email: 'not-an-email' } })).status).toBe(400);
  });

  test('運営者自身は削除できない', async () => {
    const { body } = await a.json<OwnerSummary[]>('/api/admin/owners');
    expect((await a.request(`/api/admin/owners/${body[0]!.id}`, { method: 'DELETE' })).status).toBe(400);
  });

  test('オーナーを削除すると、そのオーナーのログインと、閲覧者の参加がすべて無効になる。ほかのオーナーには影響しない', async () => {
    const va = await setup(a, [FAKE_MAIN], [[FAKE_MAIN, 'label:lbl-shift', 'detail']]);
    const vb = await setup(b, [FAKE_CLASS], [[FAKE_CLASS, 'label:lbl-attend', 'busy']]);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    await viewer.joinWith(vb.code);

    const owners = await a.json<OwnerSummary[]>('/api/admin/owners');
    const ownerB = owners.body.find((o) => o.email === OWNER_B)!;
    expect((await a.request(`/api/admin/owners/${ownerB.id}`, { method: 'DELETE' })).status).toBe(200);

    expect((await b.request('/api/admin/me')).status).toBe(401);
    const ms = await viewer.json<MembershipsResponse>('/api/viewer/memberships');
    expect(ms.body.memberships.map((m) => m.viewerId)).toEqual([va.id]);
    // 削除したオーナーの閲覧者 ID では、もう参加できない
    expect((await new TestClient(ctx.app).joinWith(vb.code)).status).toBe(401);
    // A は今までどおり
    viewer.viewerId = va.id;
    expect((await viewer.json<EventsResponse>(WEEK)).body.events.length).toBeGreaterThan(0);
    // 削除したアドレスでは、もうログインできない
    const again = new TestClient(ctx.app);
    const res = await again.loginAs(OWNER_B);
    expect(decodeURIComponent(res.headers.get('Location') ?? '')).toContain('オーナーとして登録されていません');
  });
});

describe('オーナー間のデータの分離（要件 7.6）', () => {
  test('ほかのオーナーの閲覧者は、一覧にも出ず、ID を指定しても「見つからない」', async () => {
    const va = await setup(a, [FAKE_MAIN], [[FAKE_MAIN, 'label:lbl-shift', 'detail']]);
    expect((await b.json<AdminViewerSummary[]>('/api/admin/viewers')).body).toEqual([]);

    const attempts: [string, string, unknown?][] = [
      ['GET', `/api/admin/viewers/${va.id}`],
      ['PATCH', `/api/admin/viewers/${va.id}`, { displayName: '乗っ取り' }],
      ['POST', `/api/admin/viewers/${va.id}/disable`],
      ['POST', `/api/admin/viewers/${va.id}/regenerate`],
      ['DELETE', `/api/admin/viewers/${va.id}`],
      ['GET', `/api/admin/viewers/${va.id}/rules`],
      ['PUT', `/api/admin/viewers/${va.id}/rules`, { calendarId: FAKE_MAIN, labelKey: 'none', level: 'detail' }],
      ['GET', `/api/admin/viewers/${va.id}/labels`],
      ['PUT', `/api/admin/viewers/${va.id}/labels`, { calendarId: FAKE_MAIN, labelKey: 'none', displayName: 'x' }],
      ['GET', `/api/admin/viewers/${va.id}/preview/me`],
      ['GET', `/api/admin/viewers/${va.id}/preview/events?from=2026-11-15&to=2026-11-22`],
      ['PUT', '/api/admin/overrides', { viewerId: va.id, calendarId: FAKE_MAIN, eventKey: 'shift', level: 'detail' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await b.request(path, { method, ...(body === undefined ? {} : { body }) });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }

    // A の閲覧者は何も変わっていない
    const after = await a.json<AdminViewerDetail>(`/api/admin/viewers/${va.id}`);
    expect(after.body).toMatchObject({ displayName: '母', status: 'active', code: va.code });
    expect((await a.json<unknown[]>(`/api/admin/viewers/${va.id}/rules`)).body).toHaveLength(1);
  });

  test('コピー元にほかのオーナーの閲覧者を指定できない', async () => {
    const va = await setup(a, [FAKE_MAIN], [[FAKE_MAIN, 'label:lbl-shift', 'detail']]);
    const vb = await createViewer(b, '父の友人');
    const res = await b.request(`/api/admin/viewers/${vb.id}/copy-from`, {
      method: 'POST',
      body: { sourceViewerId: va.id },
    });
    expect(res.status).toBe(404);
  });

  test('対象カレンダー・カテゴリ名・予定一覧はオーナーごと', async () => {
    await setup(a, [FAKE_MAIN], []);
    await b.request('/api/admin/calendars', { method: 'PUT', body: { calendarIds: [FAKE_CLASS] } });
    await a.request('/api/admin/labels', {
      method: 'PUT',
      body: { calendarId: FAKE_MAIN, labelKey: 'label:lbl-shift', displayName: 'バイト' },
    });

    const calsA = await a.json<{ id: string; selected: boolean }[]>('/api/admin/calendars');
    const calsB = await b.json<{ id: string; selected: boolean }[]>('/api/admin/calendars');
    expect(calsA.body.filter((c) => c.selected).map((c) => c.id)).toEqual([FAKE_MAIN]);
    expect(calsB.body.filter((c) => c.selected).map((c) => c.id)).toEqual([FAKE_CLASS]);

    const eventsB = await b.json<AdminEventsResponse>('/api/admin/events?from=2026-11-15&to=2026-11-22');
    expect(new Set(eventsB.body.events.map((e) => e.calendarId))).toEqual(new Set([FAKE_CLASS]));
    // A の閲覧者は B の予定一覧に出ない
    expect(eventsB.body.viewers).toEqual([]);
    expect(eventsB.body.events.every((e) => e.viewers.length === 0)).toBe(true);
  });

  test('キャッシュの削除は、自分のオーナーの分だけ', async () => {
    const va = await setup(a, [FAKE_MAIN], [[FAKE_MAIN, 'label:lbl-shift', 'detail']]);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    await viewer.request(WEEK);
    const before = ctx.source.calls.listEvents;
    await b.request('/api/admin/cache/clear', { method: 'POST' });
    await viewer.request(WEEK);
    expect(ctx.source.calls.listEvents).toBe(before);
  });
});

describe('閲覧者が複数のオーナーに参加する（要件 4.1、4.6）', () => {
  test('1台の端末で2人のオーナーに参加し、オーナーごとに別の予定を見る', async () => {
    await b.request('/api/admin/profile', { method: 'PUT', body: { displayName: '父' } });
    await a.request('/api/admin/profile', { method: 'PUT', body: { displayName: '山田' } });
    const va = await setup(a, [FAKE_MAIN], [[FAKE_MAIN, 'label:lbl-shift', 'detail']]);
    const vb = await setup(b, [FAKE_CLASS], [[FAKE_CLASS, 'label:lbl-attend', 'busy']]);

    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    await viewer.joinWith(vb.code);
    const ms = await viewer.json<MembershipsResponse>('/api/viewer/memberships');
    expect(ms.body).toEqual({
      memberships: [
        { viewerId: va.id, ownerName: '山田' },
        { viewerId: vb.id, ownerName: '父' },
      ],
      // 最後に参加したオーナーを選択中にする
      current: vb.id,
    });
    // オーナーのメールアドレスは閲覧者に返さない
    expect(JSON.stringify(ms.body)).not.toContain('@');

    const eventsA = await viewer.json<EventsResponse>(`${WEEK}&v=${va.id}`);
    const eventsB = await viewer.json<EventsResponse>(`${WEEK}&v=${vb.id}`);
    expect(eventsA.body.events.filter((e) => e.level === 'detail')).toHaveLength(3); // アルバイト ×3
    expect(eventsB.body.events.every((e) => e.level === 'busy')).toBe(true); // 情報理論 ×3
    expect(eventsB.body.events).toHaveLength(3);
  });

  test('参加していない閲覧者は指定できない', async () => {
    const va = await setup(a, [FAKE_MAIN], []);
    const vb = await setup(b, [FAKE_CLASS], []);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    expect((await viewer.request(`${WEEK}&v=${vb.id}`)).status).toBe(404);
    expect((await viewer.request(`/api/viewer/me?v=${vb.id}`)).status).toBe(404);
    expect((await viewer.request('/api/viewer/current', { method: 'PUT', body: { viewerId: vb.id } })).status).toBe(404);
  });

  test('最後に選んだオーナーを覚え、表示できなくなったら最初に参加したオーナーに戻る', async () => {
    const va = await setup(a, [FAKE_MAIN], []);
    const vb = await setup(b, [FAKE_CLASS], []);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    await viewer.joinWith(vb.code);
    await viewer.request('/api/viewer/current', { method: 'PUT', body: { viewerId: va.id } });
    expect((await viewer.json<MembershipsResponse>('/api/viewer/memberships')).body.current).toBe(va.id);
    await viewer.request('/api/viewer/current', { method: 'PUT', body: { viewerId: vb.id } });
    expect((await viewer.json<MembershipsResponse>('/api/viewer/memberships')).body.current).toBe(vb.id);

    // B が無効化すると、B の参加は外れ、A に戻る
    await b.request(`/api/admin/viewers/${vb.id}/disable`, { method: 'POST' });
    const ms = await viewer.json<MembershipsResponse>('/api/viewer/memberships');
    expect(ms.body).toMatchObject({ memberships: [{ viewerId: va.id }], current: va.id });
  });

  test('同じ閲覧者 ID でもう一度参加しても、参加は1つのまま', async () => {
    const va = await setup(a, [FAKE_MAIN], []);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(va.code);
    await viewer.joinWith(va.code);
    expect((await viewer.json<MembershipsResponse>('/api/viewer/memberships')).body.memberships).toHaveLength(1);
  });

  test('表示名が空欄のオーナーは「（名前未設定）」と表示する', async () => {
    const vb = await setup(b, [FAKE_CLASS], []);
    const viewer = new TestClient(ctx.app);
    await viewer.joinWith(vb.code);
    const ms = await viewer.json<MembershipsResponse>('/api/viewer/memberships');
    expect(ms.body.memberships[0]?.ownerName).toBe('（名前未設定）');
  });
});

test('表示名は30文字まで', async () => {
  expect((await a.request('/api/admin/profile', { method: 'PUT', body: { displayName: 'あ'.repeat(31) } })).status).toBe(400);
  await a.request('/api/admin/profile', { method: 'PUT', body: { displayName: ' 山田 ' } });
  expect((await a.json<AdminMe>('/api/admin/me')).body.displayName).toBe('山田');
});
