// D1 のリポジトリが、オーナーで絞り込めていることを直接確かめる（要件 7.6）。
// サービスの確認（http/multiOwner.test.ts）とは別に、SQL の条件の書き忘れをここで捕まえる。

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { NO_PERIOD_LIMIT } from '../domain/period';
import type { NewViewer, RepositoryFactory } from '../ports';
import { createTestDb, type TestDb } from '../testing/harness';
import { createD1Repositories } from './d1';

let testDb: TestDb;
let repos: RepositoryFactory;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.dispose();
});
beforeEach(async () => {
  await testDb.reset();
  repos = createD1Repositories(testDb.db);
  for (const id of ['A', 'B']) {
    await repos.global.owners.insert({ id, email: `${id}@example.com`, displayName: id, createdAt: 0, lastLoginAt: null });
  }
});

function viewer(id: string): NewViewer {
  return {
    id,
    displayName: id,
    codeEnc: `enc-${id}`,
    codeHash: `hash-${id}`,
    status: 'active',
    defaultWeekStart: 0,
    weekStart: null,
    period: NO_PERIOD_LIMIT,
    createdAt: 0,
    lastSeenAt: null,
    lastForcedRefreshAt: null,
  };
}

describe('forOwner', () => {
  test('ほかのオーナーの閲覧者は、読めず、変えられず、消せない', async () => {
    const a = repos.forOwner('A');
    const b = repos.forOwner('B');
    await a.viewers.insert(viewer('va'));
    await a.rules.set('va', 'cal', 'none', 'detail');
    await repos.global.viewerSessions.create({ tokenHash: 't', viewerId: 'va', createdAt: 0, expiresAt: 1e15, renewedAt: 0 });

    expect(await b.viewers.get('va')).toBeNull();
    expect(await b.viewers.list()).toEqual([]);
    await b.viewers.update('va', { displayName: '乗っ取り', status: 'disabled' });
    await b.viewers.deleteSessions('va');
    await b.viewers.delete('va');

    expect(await a.viewers.get('va')).toMatchObject({ displayName: 'va', status: 'active', ownerId: 'A' });
    expect(await a.rules.listForViewer('va')).toHaveLength(1);
    expect(await repos.global.viewerSessions.find('t')).not.toBeNull();
  });

  test('ルール・個別設定・カテゴリ名・カレンダー・トークン・キャッシュはオーナーごと', async () => {
    const a = repos.forOwner('A');
    const b = repos.forOwner('B');
    await a.viewers.insert(viewer('va'));
    await a.rules.set('va', 'cal', 'none', 'detail');
    await a.overrides.set('va', 'cal', 'ev', 'busy');
    await a.viewerLabelNames.set('va', 'cal', 'none', 'x');
    await a.labelNames.set('cal', 'none', 'y');
    await a.calendarSelection.replace(['cal']);
    await a.tokens.save({ refreshTokenEnc: 'r', accessTokenEnc: null, accessExpiresAt: null, scope: 's', updatedAt: 0 });
    await a.cache.put('k', 'v', 0);

    expect(await b.rules.listAll()).toEqual([]);
    expect(await b.overrides.listAll()).toEqual([]);
    expect(await b.viewerLabelNames.listForViewer('va')).toEqual([]);
    expect(await b.labelNames.list()).toEqual([]);
    expect(await b.calendarSelection.list()).toEqual([]);
    expect(await b.tokens.get()).toBeNull();
    expect(await b.cache.get('k')).toBeNull();

    // B の削除・置き換えで A のデータは消えない
    await b.rules.replaceAll('va', []);
    await b.overrides.replaceAll('va', []);
    await b.viewerLabelNames.replaceAll('va', []);
    await b.calendarSelection.replace([]);
    await b.tokens.clear();
    await b.cache.deleteAll();
    expect(await a.rules.listAll()).toHaveLength(1);
    expect(await a.overrides.listAll()).toHaveLength(1);
    expect(await a.viewerLabelNames.listForViewer('va')).toHaveLength(1);
    expect(await a.calendarSelection.list()).toEqual(['cal']);
    expect(await a.tokens.get()).not.toBeNull();
    expect(await a.cache.get('k')).not.toBeNull();
  });

  test('オーナーを削除すると、そのオーナーのデータがすべて消え、ほかのオーナーのデータは残る', async () => {
    for (const owner of ['A', 'B']) {
      const r = repos.forOwner(owner);
      await r.viewers.insert({ ...viewer(`v${owner}`), codeHash: `hash-${owner}` });
      await r.rules.set(`v${owner}`, 'cal', 'none', 'detail');
      await r.cache.put('k', 'v', 0);
      await r.tokens.save({ refreshTokenEnc: 'r', accessTokenEnc: null, accessExpiresAt: null, scope: 's', updatedAt: 0 });
      await repos.global.viewerSessions.create({
        tokenHash: `t${owner}`,
        viewerId: `v${owner}`,
        createdAt: 0,
        expiresAt: 1e15,
        renewedAt: 0,
      });
      await repos.global.ownerSessions.create({ tokenHash: `o${owner}`, ownerId: owner, createdAt: 0, expiresAt: 1e15 });
    }
    await repos.global.owners.delete('B');

    const b = repos.forOwner('B');
    expect(await repos.global.owners.get('B')).toBeNull();
    expect(await b.viewers.list()).toEqual([]);
    expect(await b.rules.listAll()).toEqual([]);
    expect(await b.cache.get('k')).toBeNull();
    expect(await b.tokens.get()).toBeNull();
    expect(await repos.global.viewerSessions.find('tB')).toBeNull();
    expect(await repos.global.ownerSessions.find('oB')).toBeNull();

    const a = repos.forOwner('A');
    expect(await a.viewers.list()).toHaveLength(1);
    expect(await a.rules.listAll()).toHaveLength(1);
    expect(await repos.global.viewerSessions.find('tA')).not.toBeNull();
    expect(await repos.global.ownerSessions.find('oA')).not.toBeNull();
  });

  test('すべての表に owner_id がある（オーナーに関係しない表を除く）', async () => {
    const { results } = await testDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
      .all<{ name: string }>();
    // owners は自分自身、viewer_sessions は viewers を通してオーナーが決まる、join_failures はオーナーに関係しない
    const exempt = new Set(['owners', 'viewer_sessions', 'join_failures']);
    for (const { name } of results) {
      if (exempt.has(name)) continue;
      const cols = await testDb.db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
      expect([name, cols.results.some((c) => c.name === 'owner_id')]).toEqual([name, true]);
    }
  });
});
