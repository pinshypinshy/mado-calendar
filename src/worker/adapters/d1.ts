// D1 によるリポジトリの実装。
// forOwner で作るリポジトリは、すべての問い合わせを owner_id で絞り込む（要件 7.6）。
// ほかのオーナーの行は、読み取りでは見つからず、更新・削除では1行も変わらない。

import type { Level, OverrideLevel, WeekStart } from '../../shared/api';
import type { LabelNameRow } from '../domain/labels';
import type { OverrideRow, RuleRow } from '../domain/level';
import type {
  GlobalRepositories,
  OwnerRecord,
  OwnerRepositories,
  RepositoryFactory,
  StoredToken,
  ViewerPatch,
  ViewerRecord,
} from '../ports';

export function createD1Repositories(db: D1Database): RepositoryFactory {
  return {
    global: createGlobalRepositories(db),
    forOwner: (ownerId) => createOwnerRepositories(db, ownerId),
  };
}

function createGlobalRepositories(db: D1Database): GlobalRepositories {
  return {
    owners: {
      async list() {
        const { results } = await db.prepare('SELECT * FROM owners ORDER BY created_at').all<OwnerRow>();
        return results.map(toOwner);
      },
      async get(id) {
        const row = await db.prepare('SELECT * FROM owners WHERE id = ?').bind(id).first<OwnerRow>();
        return row ? toOwner(row) : null;
      },
      async findByEmail(email) {
        const row = await db
          .prepare('SELECT * FROM owners WHERE email = ?')
          .bind(email.toLowerCase())
          .first<OwnerRow>();
        return row ? toOwner(row) : null;
      },
      async insert(o: OwnerRecord) {
        await db
          .prepare('INSERT INTO owners (id, email, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)')
          .bind(o.id, o.email.toLowerCase(), o.displayName, o.createdAt, o.lastLoginAt)
          .run();
      },
      async updateDisplayName(id, displayName) {
        await db.prepare('UPDATE owners SET display_name = ? WHERE id = ?').bind(displayName, id).run();
      },
      async touchLogin(id, at) {
        await db.prepare('UPDATE owners SET last_login_at = ? WHERE id = ?').bind(at, id).run();
      },
      async delete(id) {
        // 外部キーの ON DELETE CASCADE に頼らず、オーナーのデータを明示的にすべて消す
        await db.batch([
          db
            .prepare('DELETE FROM viewer_sessions WHERE viewer_id IN (SELECT id FROM viewers WHERE owner_id = ?)')
            .bind(id),
          ...[
            'display_rules',
            'event_overrides',
            'viewer_label_names',
            'viewers',
            'selected_calendars',
            'label_names',
            'cache_entries',
            'oauth_tokens',
            'owner_sessions',
          ].map((table) => db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(id)),
          db.prepare('DELETE FROM owners WHERE id = ?').bind(id),
        ]);
      },
    },

    ownerSessions: {
      async create(s) {
        await db
          .prepare('INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(s.tokenHash, s.ownerId, s.createdAt, s.expiresAt)
          .run();
      },
      async find(tokenHash) {
        const r = await db
          .prepare('SELECT * FROM owner_sessions WHERE token_hash = ?')
          .bind(tokenHash)
          .first<{ token_hash: string; owner_id: string; created_at: number; expires_at: number }>();
        return r ? { tokenHash: r.token_hash, ownerId: r.owner_id, createdAt: r.created_at, expiresAt: r.expires_at } : null;
      },
      async delete(tokenHash) {
        await db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').bind(tokenHash).run();
      },
    },

    viewerDirectory: {
      async get(id) {
        const row = await db.prepare('SELECT * FROM viewers WHERE id = ?').bind(id).first<ViewerRow>();
        return row ? toViewer(row) : null;
      },
      async findByCodeHash(codeHash) {
        const row = await db.prepare('SELECT * FROM viewers WHERE code_hash = ?').bind(codeHash).first<ViewerRow>();
        return row ? toViewer(row) : null;
      },
    },

    viewerSessions: {
      async create(s) {
        await db
          .prepare(
            'INSERT INTO viewer_sessions (token_hash, viewer_id, created_at, expires_at, renewed_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(s.tokenHash, s.viewerId, s.createdAt, s.expiresAt, s.renewedAt)
          .run();
      },
      async find(tokenHash) {
        const r = await db
          .prepare('SELECT * FROM viewer_sessions WHERE token_hash = ?')
          .bind(tokenHash)
          .first<{ token_hash: string; viewer_id: string; created_at: number; expires_at: number; renewed_at: number }>();
        return r
          ? {
              tokenHash: r.token_hash,
              viewerId: r.viewer_id,
              createdAt: r.created_at,
              expiresAt: r.expires_at,
              renewedAt: r.renewed_at,
            }
          : null;
      },
      async renew(tokenHash, expiresAt, renewedAt) {
        await db
          .prepare('UPDATE viewer_sessions SET expires_at = ?, renewed_at = ? WHERE token_hash = ?')
          .bind(expiresAt, renewedAt, tokenHash)
          .run();
      },
      async delete(tokenHash) {
        await db.prepare('DELETE FROM viewer_sessions WHERE token_hash = ?').bind(tokenHash).run();
      },
    },

    joinFailures: {
      async countSince(ip, since) {
        const r = await db
          .prepare('SELECT COUNT(*) AS n FROM join_failures WHERE ip = ? AND at >= ?')
          .bind(ip, since)
          .first<{ n: number }>();
        return r?.n ?? 0;
      },
      async record(ip, at) {
        await db.prepare('INSERT INTO join_failures (ip, at) VALUES (?, ?)').bind(ip, at).run();
      },
      async purgeBefore(at) {
        await db.prepare('DELETE FROM join_failures WHERE at < ?').bind(at).run();
      },
    },
  };
}

function createOwnerRepositories(db: D1Database, ownerId: string): OwnerRepositories {
  /** 閲覧者がこのオーナーのものであることを、書き込みの条件に含めるための SQL 断片 */
  const ownViewer = 'viewer_id IN (SELECT id FROM viewers WHERE id = ? AND owner_id = ?)';

  return {
    ownerId,

    viewers: {
      async list() {
        const { results } = await db
          .prepare('SELECT * FROM viewers WHERE owner_id = ? ORDER BY created_at')
          .bind(ownerId)
          .all<ViewerRow>();
        return results.map(toViewer);
      },
      async get(id) {
        const row = await db
          .prepare('SELECT * FROM viewers WHERE id = ? AND owner_id = ?')
          .bind(id, ownerId)
          .first<ViewerRow>();
        return row ? toViewer(row) : null;
      },
      async insert(v) {
        await db
          .prepare(
            `INSERT INTO viewers (id, owner_id, display_name, code_enc, code_hash, status, default_week_start, week_start,
               period_enabled, period_past_months, period_future_months, created_at, last_seen_at, last_forced_refresh_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            v.id,
            ownerId,
            v.displayName,
            v.codeEnc,
            v.codeHash,
            v.status,
            v.defaultWeekStart,
            v.weekStart,
            v.period.enabled ? 1 : 0,
            v.period.pastMonths,
            v.period.futureMonths,
            v.createdAt,
            v.lastSeenAt,
            v.lastForcedRefreshAt,
          )
          .run();
      },
      async update(id, patch) {
        const { sql, values } = viewerPatchToSql(patch);
        if (sql.length === 0) return;
        await db
          .prepare(`UPDATE viewers SET ${sql.join(', ')} WHERE id = ? AND owner_id = ?`)
          .bind(...values, id, ownerId)
          .run();
      },
      async delete(id) {
        await db.batch([
          db.prepare(`DELETE FROM viewer_sessions WHERE ${ownViewer}`).bind(id, ownerId),
          ...['display_rules', 'event_overrides', 'viewer_label_names'].map((table) =>
            db.prepare(`DELETE FROM ${table} WHERE owner_id = ? AND viewer_id = ?`).bind(ownerId, id),
          ),
          db.prepare('DELETE FROM viewers WHERE id = ? AND owner_id = ?').bind(id, ownerId),
        ]);
      },
      async deleteSessions(id) {
        await db.prepare(`DELETE FROM viewer_sessions WHERE ${ownViewer}`).bind(id, ownerId).run();
      },
    },

    rules: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare('SELECT calendar_id, label_key, level FROM display_rules WHERE owner_id = ? AND viewer_id = ?')
          .bind(ownerId, viewerId)
          .all<{ calendar_id: string; label_key: string; level: Level }>();
        return results.map((r) => ({ calendarId: r.calendar_id, labelKey: r.label_key, level: r.level }));
      },
      async listAll() {
        const { results } = await db
          .prepare('SELECT viewer_id, calendar_id, label_key, level FROM display_rules WHERE owner_id = ?')
          .bind(ownerId)
          .all<{ viewer_id: string; calendar_id: string; label_key: string; level: Level }>();
        return results.map((r) => ({
          viewerId: r.viewer_id,
          calendarId: r.calendar_id,
          labelKey: r.label_key,
          level: r.level,
        }));
      },
      async set(viewerId, calendarId, labelKey, level) {
        await db
          .prepare(
            `INSERT INTO display_rules (owner_id, viewer_id, calendar_id, label_key, level) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (owner_id, viewer_id, calendar_id, label_key) DO UPDATE SET level = excluded.level`,
          )
          .bind(ownerId, viewerId, calendarId, labelKey, level)
          .run();
      },
      async replaceAll(viewerId, rows: RuleRow[]) {
        await db.batch([
          db.prepare('DELETE FROM display_rules WHERE owner_id = ? AND viewer_id = ?').bind(ownerId, viewerId),
          ...rows.map((r) =>
            db
              .prepare(
                'INSERT INTO display_rules (owner_id, viewer_id, calendar_id, label_key, level) VALUES (?, ?, ?, ?, ?)',
              )
              .bind(ownerId, viewerId, r.calendarId, r.labelKey, r.level),
          ),
        ]);
      },
    },

    overrides: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare('SELECT calendar_id, event_key, level FROM event_overrides WHERE owner_id = ? AND viewer_id = ?')
          .bind(ownerId, viewerId)
          .all<{ calendar_id: string; event_key: string; level: OverrideLevel }>();
        return results.map((r) => ({ calendarId: r.calendar_id, eventKey: r.event_key, level: r.level }));
      },
      async listAll() {
        const { results } = await db
          .prepare('SELECT viewer_id, calendar_id, event_key, level FROM event_overrides WHERE owner_id = ?')
          .bind(ownerId)
          .all<{ viewer_id: string; calendar_id: string; event_key: string; level: OverrideLevel }>();
        return results.map((r) => ({
          viewerId: r.viewer_id,
          calendarId: r.calendar_id,
          eventKey: r.event_key,
          level: r.level,
        }));
      },
      async set(viewerId, calendarId, eventKey, level) {
        if (level === null) {
          await db
            .prepare(
              'DELETE FROM event_overrides WHERE owner_id = ? AND viewer_id = ? AND calendar_id = ? AND event_key = ?',
            )
            .bind(ownerId, viewerId, calendarId, eventKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO event_overrides (owner_id, viewer_id, calendar_id, event_key, level) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (owner_id, viewer_id, calendar_id, event_key) DO UPDATE SET level = excluded.level`,
          )
          .bind(ownerId, viewerId, calendarId, eventKey, level)
          .run();
      },
      async replaceAll(viewerId, rows: OverrideRow[]) {
        await db.batch([
          db.prepare('DELETE FROM event_overrides WHERE owner_id = ? AND viewer_id = ?').bind(ownerId, viewerId),
          ...rows.map((r) =>
            db
              .prepare(
                'INSERT INTO event_overrides (owner_id, viewer_id, calendar_id, event_key, level) VALUES (?, ?, ?, ?, ?)',
              )
              .bind(ownerId, viewerId, r.calendarId, r.eventKey, r.level),
          ),
        ]);
      },
    },

    calendarSelection: {
      async list() {
        const { results } = await db
          .prepare('SELECT calendar_id FROM selected_calendars WHERE owner_id = ? ORDER BY position')
          .bind(ownerId)
          .all<{ calendar_id: string }>();
        return results.map((r) => r.calendar_id);
      },
      async replace(calendarIds) {
        await db.batch([
          db.prepare('DELETE FROM selected_calendars WHERE owner_id = ?').bind(ownerId),
          ...calendarIds.map((id, i) =>
            db
              .prepare('INSERT INTO selected_calendars (owner_id, calendar_id, position) VALUES (?, ?, ?)')
              .bind(ownerId, id, i),
          ),
        ]);
      },
    },

    labelNames: {
      async list() {
        const { results } = await db
          .prepare('SELECT calendar_id, label_key, display_name FROM label_names WHERE owner_id = ?')
          .bind(ownerId)
          .all<{ calendar_id: string; label_key: string; display_name: string }>();
        return results.map(toLabelName);
      },
      async set(calendarId, labelKey, displayName) {
        if (displayName === null) {
          await db
            .prepare('DELETE FROM label_names WHERE owner_id = ? AND calendar_id = ? AND label_key = ?')
            .bind(ownerId, calendarId, labelKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO label_names (owner_id, calendar_id, label_key, display_name) VALUES (?, ?, ?, ?)
             ON CONFLICT (owner_id, calendar_id, label_key) DO UPDATE SET display_name = excluded.display_name`,
          )
          .bind(ownerId, calendarId, labelKey, displayName)
          .run();
      },
    },

    viewerLabelNames: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare(
            'SELECT calendar_id, label_key, display_name FROM viewer_label_names WHERE owner_id = ? AND viewer_id = ?',
          )
          .bind(ownerId, viewerId)
          .all<{ calendar_id: string; label_key: string; display_name: string }>();
        return results.map(toLabelName);
      },
      async set(viewerId, calendarId, labelKey, displayName) {
        if (displayName === null) {
          await db
            .prepare(
              'DELETE FROM viewer_label_names WHERE owner_id = ? AND viewer_id = ? AND calendar_id = ? AND label_key = ?',
            )
            .bind(ownerId, viewerId, calendarId, labelKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO viewer_label_names (owner_id, viewer_id, calendar_id, label_key, display_name) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (owner_id, viewer_id, calendar_id, label_key) DO UPDATE SET display_name = excluded.display_name`,
          )
          .bind(ownerId, viewerId, calendarId, labelKey, displayName)
          .run();
      },
      async replaceAll(viewerId, rows: LabelNameRow[]) {
        await db.batch([
          db.prepare('DELETE FROM viewer_label_names WHERE owner_id = ? AND viewer_id = ?').bind(ownerId, viewerId),
          ...rows.map((r) =>
            db
              .prepare(
                'INSERT INTO viewer_label_names (owner_id, viewer_id, calendar_id, label_key, display_name) VALUES (?, ?, ?, ?, ?)',
              )
              .bind(ownerId, viewerId, r.calendarId, r.labelKey, r.displayName),
          ),
        ]);
      },
    },

    tokens: {
      async get() {
        const r = await db.prepare('SELECT * FROM oauth_tokens WHERE owner_id = ?').bind(ownerId).first<{
          refresh_token_enc: string;
          access_token_enc: string | null;
          access_expires_at: number | null;
          scope: string;
          updated_at: number;
        }>();
        return r
          ? {
              refreshTokenEnc: r.refresh_token_enc,
              accessTokenEnc: r.access_token_enc,
              accessExpiresAt: r.access_expires_at,
              scope: r.scope,
              updatedAt: r.updated_at,
            }
          : null;
      },
      async save(t: StoredToken) {
        await db
          .prepare(
            `INSERT INTO oauth_tokens (owner_id, refresh_token_enc, access_token_enc, access_expires_at, scope, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (owner_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc,
               access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
               scope = excluded.scope, updated_at = excluded.updated_at`,
          )
          .bind(ownerId, t.refreshTokenEnc, t.accessTokenEnc, t.accessExpiresAt, t.scope, t.updatedAt)
          .run();
      },
      async clear() {
        await db.prepare('DELETE FROM oauth_tokens WHERE owner_id = ?').bind(ownerId).run();
      },
    },

    cache: {
      async get(key) {
        const r = await db
          .prepare('SELECT fetched_at, payload FROM cache_entries WHERE owner_id = ? AND key = ?')
          .bind(ownerId, key)
          .first<{ fetched_at: number; payload: string }>();
        return r ? { fetchedAt: r.fetched_at, payload: r.payload } : null;
      },
      async put(key, payload, fetchedAt) {
        await db
          .prepare(
            `INSERT INTO cache_entries (owner_id, key, fetched_at, payload) VALUES (?, ?, ?, ?)
             ON CONFLICT (owner_id, key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
          )
          .bind(ownerId, key, fetchedAt, payload)
          .run();
      },
      async deleteAll() {
        await db.prepare('DELETE FROM cache_entries WHERE owner_id = ?').bind(ownerId).run();
      },
    },
  };
}

interface OwnerRow {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
  last_login_at: number | null;
}

function toOwner(r: OwnerRow): OwnerRecord {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

interface ViewerRow {
  id: string;
  owner_id: string;
  display_name: string;
  code_enc: string;
  code_hash: string;
  status: 'active' | 'disabled';
  default_week_start: number;
  week_start: number | null;
  period_enabled: number;
  period_past_months: number | null;
  period_future_months: number | null;
  created_at: number;
  last_seen_at: number | null;
  last_forced_refresh_at: number | null;
}

function toViewer(r: ViewerRow): ViewerRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    displayName: r.display_name,
    codeEnc: r.code_enc,
    codeHash: r.code_hash,
    status: r.status,
    defaultWeekStart: r.default_week_start as WeekStart,
    weekStart: r.week_start === null ? null : (r.week_start as WeekStart),
    period: {
      enabled: r.period_enabled === 1,
      pastMonths: r.period_past_months,
      futureMonths: r.period_future_months,
    },
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    lastForcedRefreshAt: r.last_forced_refresh_at,
  };
}

function toLabelName(r: { calendar_id: string; label_key: string; display_name: string }): LabelNameRow {
  return { calendarId: r.calendar_id, labelKey: r.label_key, displayName: r.display_name };
}

function viewerPatchToSql(patch: ViewerPatch): { sql: string[]; values: unknown[] } {
  const sql: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sql.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.displayName !== undefined) add('display_name', patch.displayName);
  if (patch.codeEnc !== undefined) add('code_enc', patch.codeEnc);
  if (patch.codeHash !== undefined) add('code_hash', patch.codeHash);
  if (patch.status !== undefined) add('status', patch.status);
  if (patch.defaultWeekStart !== undefined) add('default_week_start', patch.defaultWeekStart);
  if (patch.weekStart !== undefined) add('week_start', patch.weekStart);
  if (patch.period !== undefined) {
    add('period_enabled', patch.period.enabled ? 1 : 0);
    add('period_past_months', patch.period.pastMonths);
    add('period_future_months', patch.period.futureMonths);
  }
  if (patch.lastSeenAt !== undefined) add('last_seen_at', patch.lastSeenAt);
  if (patch.lastForcedRefreshAt !== undefined) add('last_forced_refresh_at', patch.lastForcedRefreshAt);
  return { sql, values };
}
