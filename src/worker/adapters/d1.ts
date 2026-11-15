// D1 によるリポジトリの実装。

import type { Level, OverrideLevel, WeekStart } from '../../shared/api';
import type { OverrideRow, RuleRow } from '../domain/level';
import type {
  AdminSessionRecord,
  CacheEntry,
  Repositories,
  StoredToken,
  ViewerPatch,
  ViewerRecord,
  ViewerSessionRecord,
} from '../ports';

export function createD1Repositories(db: D1Database): Repositories {
  return {
    viewers: {
      async list() {
        const { results } = await db.prepare('SELECT * FROM viewers ORDER BY created_at').all<ViewerRow>();
        return results.map(toViewer);
      },
      async get(id) {
        const row = await db.prepare('SELECT * FROM viewers WHERE id = ?').bind(id).first<ViewerRow>();
        return row ? toViewer(row) : null;
      },
      async findByCodeHash(codeHash) {
        const row = await db.prepare('SELECT * FROM viewers WHERE code_hash = ?').bind(codeHash).first<ViewerRow>();
        return row ? toViewer(row) : null;
      },
      async insert(v) {
        await db
          .prepare(
            `INSERT INTO viewers (id, display_name, code_enc, code_hash, status, default_week_start, week_start,
               period_enabled, period_past_months, period_future_months, created_at, last_seen_at, last_forced_refresh_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            v.id,
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
          .prepare(`UPDATE viewers SET ${sql.join(', ')} WHERE id = ?`)
          .bind(...values, id)
          .run();
      },
      async delete(id) {
        // 外部キーの ON DELETE CASCADE に頼らず、明示的に消す
        await db.batch([
          db.prepare('DELETE FROM viewer_sessions WHERE viewer_id = ?').bind(id),
          db.prepare('DELETE FROM display_rules WHERE viewer_id = ?').bind(id),
          db.prepare('DELETE FROM event_overrides WHERE viewer_id = ?').bind(id),
          db.prepare('DELETE FROM viewer_label_names WHERE viewer_id = ?').bind(id),
          db.prepare('DELETE FROM viewers WHERE id = ?').bind(id),
        ]);
      },
    },

    rules: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare('SELECT calendar_id, label_key, level FROM display_rules WHERE viewer_id = ?')
          .bind(viewerId)
          .all<{ calendar_id: string; label_key: string; level: Level }>();
        return results.map((r) => ({ calendarId: r.calendar_id, labelKey: r.label_key, level: r.level }));
      },
      async listAll() {
        const { results } = await db
          .prepare('SELECT viewer_id, calendar_id, label_key, level FROM display_rules')
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
            `INSERT INTO display_rules (viewer_id, calendar_id, label_key, level) VALUES (?, ?, ?, ?)
             ON CONFLICT (viewer_id, calendar_id, label_key) DO UPDATE SET level = excluded.level`,
          )
          .bind(viewerId, calendarId, labelKey, level)
          .run();
      },
      async replaceAll(viewerId, rows: RuleRow[]) {
        await db.batch([
          db.prepare('DELETE FROM display_rules WHERE viewer_id = ?').bind(viewerId),
          ...rows.map((r) =>
            db
              .prepare('INSERT INTO display_rules (viewer_id, calendar_id, label_key, level) VALUES (?, ?, ?, ?)')
              .bind(viewerId, r.calendarId, r.labelKey, r.level),
          ),
        ]);
      },
    },

    overrides: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare('SELECT calendar_id, event_key, level FROM event_overrides WHERE viewer_id = ?')
          .bind(viewerId)
          .all<{ calendar_id: string; event_key: string; level: OverrideLevel }>();
        return results.map((r) => ({ calendarId: r.calendar_id, eventKey: r.event_key, level: r.level }));
      },
      async listAll() {
        const { results } = await db
          .prepare('SELECT viewer_id, calendar_id, event_key, level FROM event_overrides')
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
            .prepare('DELETE FROM event_overrides WHERE viewer_id = ? AND calendar_id = ? AND event_key = ?')
            .bind(viewerId, calendarId, eventKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO event_overrides (viewer_id, calendar_id, event_key, level) VALUES (?, ?, ?, ?)
             ON CONFLICT (viewer_id, calendar_id, event_key) DO UPDATE SET level = excluded.level`,
          )
          .bind(viewerId, calendarId, eventKey, level)
          .run();
      },
      async replaceAll(viewerId, rows: OverrideRow[]) {
        await db.batch([
          db.prepare('DELETE FROM event_overrides WHERE viewer_id = ?').bind(viewerId),
          ...rows.map((r) =>
            db
              .prepare('INSERT INTO event_overrides (viewer_id, calendar_id, event_key, level) VALUES (?, ?, ?, ?)')
              .bind(viewerId, r.calendarId, r.eventKey, r.level),
          ),
        ]);
      },
    },

    viewerSessions: {
      async create(s: ViewerSessionRecord) {
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
      async deleteForViewer(viewerId) {
        await db.prepare('DELETE FROM viewer_sessions WHERE viewer_id = ?').bind(viewerId).run();
      },
    },

    adminSessions: {
      async create(s: AdminSessionRecord) {
        await db
          .prepare('INSERT INTO admin_sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(s.tokenHash, s.email, s.createdAt, s.expiresAt)
          .run();
      },
      async find(tokenHash) {
        const r = await db
          .prepare('SELECT * FROM admin_sessions WHERE token_hash = ?')
          .bind(tokenHash)
          .first<{ token_hash: string; email: string; created_at: number; expires_at: number }>();
        return r ? { tokenHash: r.token_hash, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at } : null;
      },
      async delete(tokenHash) {
        await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
      },
    },

    calendarSelection: {
      async list() {
        const { results } = await db
          .prepare('SELECT calendar_id FROM selected_calendars ORDER BY position')
          .all<{ calendar_id: string }>();
        return results.map((r) => r.calendar_id);
      },
      async replace(calendarIds) {
        await db.batch([
          db.prepare('DELETE FROM selected_calendars'),
          ...calendarIds.map((id, i) =>
            db.prepare('INSERT INTO selected_calendars (calendar_id, position) VALUES (?, ?)').bind(id, i),
          ),
        ]);
      },
    },

    labelNames: {
      async list() {
        const { results } = await db
          .prepare('SELECT calendar_id, label_key, display_name FROM label_names')
          .all<{ calendar_id: string; label_key: string; display_name: string }>();
        return results.map((r) => ({ calendarId: r.calendar_id, labelKey: r.label_key, displayName: r.display_name }));
      },
      async set(calendarId, labelKey, displayName) {
        if (displayName === null) {
          await db
            .prepare('DELETE FROM label_names WHERE calendar_id = ? AND label_key = ?')
            .bind(calendarId, labelKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO label_names (calendar_id, label_key, display_name) VALUES (?, ?, ?)
             ON CONFLICT (calendar_id, label_key) DO UPDATE SET display_name = excluded.display_name`,
          )
          .bind(calendarId, labelKey, displayName)
          .run();
      },
    },

    viewerLabelNames: {
      async listForViewer(viewerId) {
        const { results } = await db
          .prepare('SELECT calendar_id, label_key, display_name FROM viewer_label_names WHERE viewer_id = ?')
          .bind(viewerId)
          .all<{ calendar_id: string; label_key: string; display_name: string }>();
        return results.map((r) => ({ calendarId: r.calendar_id, labelKey: r.label_key, displayName: r.display_name }));
      },
      async set(viewerId, calendarId, labelKey, displayName) {
        if (displayName === null) {
          await db
            .prepare('DELETE FROM viewer_label_names WHERE viewer_id = ? AND calendar_id = ? AND label_key = ?')
            .bind(viewerId, calendarId, labelKey)
            .run();
          return;
        }
        await db
          .prepare(
            `INSERT INTO viewer_label_names (viewer_id, calendar_id, label_key, display_name) VALUES (?, ?, ?, ?)
             ON CONFLICT (viewer_id, calendar_id, label_key) DO UPDATE SET display_name = excluded.display_name`,
          )
          .bind(viewerId, calendarId, labelKey, displayName)
          .run();
      },
      async replaceAll(viewerId, rows) {
        await db.batch([
          db.prepare('DELETE FROM viewer_label_names WHERE viewer_id = ?').bind(viewerId),
          ...rows.map((r) =>
            db
              .prepare(
                'INSERT INTO viewer_label_names (viewer_id, calendar_id, label_key, display_name) VALUES (?, ?, ?, ?)',
              )
              .bind(viewerId, r.calendarId, r.labelKey, r.displayName),
          ),
        ]);
      },
    },

    tokens: {
      async get() {
        const r = await db.prepare('SELECT * FROM oauth_token WHERE id = 1').first<{
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
            `INSERT INTO oauth_token (id, refresh_token_enc, access_token_enc, access_expires_at, scope, updated_at)
             VALUES (1, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc,
               access_token_enc = excluded.access_token_enc, access_expires_at = excluded.access_expires_at,
               scope = excluded.scope, updated_at = excluded.updated_at`,
          )
          .bind(t.refreshTokenEnc, t.accessTokenEnc, t.accessExpiresAt, t.scope, t.updatedAt)
          .run();
      },
      async clear() {
        await db.prepare('DELETE FROM oauth_token').run();
      },
    },

    cache: {
      async get(key) {
        const r = await db
          .prepare('SELECT fetched_at, payload FROM cache_entries WHERE key = ?')
          .bind(key)
          .first<{ fetched_at: number; payload: string }>();
        return r ? ({ fetchedAt: r.fetched_at, payload: r.payload } satisfies CacheEntry) : null;
      },
      async put(key, payload, fetchedAt) {
        await db
          .prepare(
            `INSERT INTO cache_entries (key, fetched_at, payload) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
          )
          .bind(key, fetchedAt, payload)
          .run();
      },
      async deleteAll() {
        await db.prepare('DELETE FROM cache_entries').run();
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

interface ViewerRow {
  id: string;
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
