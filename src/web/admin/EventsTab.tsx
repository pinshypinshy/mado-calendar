// 予定ごとの個別設定（要件 3.5）。

import { useCallback, useState } from 'react';
import type { AdminEvent, AdminEventViewerState, AdminViewerSummary, OverrideLevel } from '../../shared/api';
import { LEVEL_LABELS, OVERRIDE_LEVELS } from '../../shared/api';
import { addDays, type DateStr, jstDateOf } from '../../shared/time';
import type { AdminApi } from '../api/clients';
import { formatDateJa, formatEventTime, periodTitle } from '../calendar/layout';
import { errorMessage } from '../ui/errors';
import { useLoad } from './useLoad';

type Scope = 'series' | 'instance';

export function EventsTab({ api }: { api: AdminApi }) {
  const [anchor, setAnchor] = useState<DateStr>(() => jstDateOf(Date.now()));
  const { data, error, reload, setError } = useLoad(useCallback(() => api.events(anchor, addDays(anchor, 7)), [api, anchor]));
  const [open, setOpen] = useState<string | null>(null);

  const setOverride = async (viewerId: string, e: AdminEvent, scope: Scope, level: OverrideLevel | null) => {
    const eventKey = scope === 'instance' ? e.eventId : (e.recurringEventId ?? e.eventId);
    try {
      await api.setOverride(viewerId, e.calendarId, eventKey, level);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  return (
    <section>
      <div className="week-nav">
        <button type="button" onClick={() => setAnchor(addDays(anchor, -7))}>
          ‹
        </button>
        <strong>{periodTitle('week', anchor)}</strong>
        <button type="button" onClick={() => setAnchor(jstDateOf(Date.now()))}>
          今日
        </button>
        <button type="button" onClick={() => setAnchor(addDays(anchor, 7))}>
          ›
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">読み込み中…</p>}
      {data &&
        days.map((d) => {
          // 予定は開始日に1回だけ出す（週より前に始まった予定は週の初日に出す）
          const dayEvents = data.events.filter((e) => maxDate(jstDateOf(e.start), anchor) === d);
          if (dayEvents.length === 0) return null;
          return (
            <div key={d}>
              <h4>{formatDateJa(d)}</h4>
              {dayEvents.map((e) => {
                const key = `${e.calendarId}\u0000${e.eventId}`;
                return (
                  <div key={key} className="card event-card">
                    <button type="button" className="list-button" onClick={() => setOpen(open === key ? null : key)}>
                      <span>
                        <span className="swatch" style={{ background: e.color }} />
                        {e.title || '（タイトルなし）'}
                        {e.recurringEventId && <span className="badge">繰り返し</span>}
                      </span>
                      <span className="muted small">
                        {formatEventTime(e)}・{e.categoryName === e.calendarName ? e.calendarName : `${e.categoryName}・${e.calendarName}`}
                      </span>
                      <span className="levels">
                        {e.viewers.map((s) => (
                          <span key={s.viewerId} className={`level level-${s.effective}`}>
                            {nameOf(data.viewers, s.viewerId)}：{LEVEL_LABELS[s.effective]}
                          </span>
                        ))}
                      </span>
                    </button>
                    {open === key && (
                      <OverrideEditor event={e} viewers={data.viewers} onChange={(v, scope, level) => void setOverride(v, e, scope, level)} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      {data && data.events.length === 0 && <p className="muted">予定はありません（対象カレンダーを選んでいるか確認してください）</p>}
    </section>
  );
}

function OverrideEditor({
  event,
  viewers,
  onChange,
}: {
  event: AdminEvent;
  viewers: AdminViewerSummary[];
  onChange: (viewerId: string, scope: Scope, level: OverrideLevel | null) => void;
}) {
  const [scope, setScope] = useState<Scope>('series');
  const recurring = event.recurringEventId !== null;
  const baseDefault = event.title.startsWith('#') ? '非表示（# の予定）' : 'ラベルに従う';
  const instanceScope = recurring && scope === 'instance';
  const valueOf = (s: AdminEventViewerState) => (instanceScope ? s.instanceLevel : s.seriesLevel);
  // 「この回のみ」が未設定の回には、シリーズ全体の設定（それも未設定なら初期値）が使われる
  const defaultLabel = (s: AdminEventViewerState) =>
    instanceScope && s.seriesLevel !== null ? `シリーズの設定：${LEVEL_LABELS[s.seriesLevel]}` : `初期値：${baseDefault}`;

  return (
    <div className="override-editor">
      {recurring && (
        <div className="segmented">
          <button type="button" aria-pressed={scope === 'series'} onClick={() => setScope('series')}>
            シリーズ全体
          </button>
          <button type="button" aria-pressed={scope === 'instance'} onClick={() => setScope('instance')}>
            この回のみ
          </button>
        </div>
      )}
      {event.viewers.map((s) => (
        <div key={s.viewerId} className="row">
          <span className="row-label">{nameOf(viewers, s.viewerId)}</span>
          <select
            value={valueOf(s) ?? ''}
            onChange={(e) => onChange(s.viewerId, scope, e.target.value === '' ? null : (e.target.value as OverrideLevel))}
          >
            <option value="">{defaultLabel(s)}</option>
            {OVERRIDE_LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                {LEVEL_LABELS[lv]}
              </option>
            ))}
          </select>
        </div>
      ))}
      {event.viewers.length === 0 && <p className="muted small">閲覧者がいません</p>}
      <p className="muted small">ラベル：{event.labelKey}</p>
    </div>
  );
}

function nameOf(viewers: AdminViewerSummary[], id: string): string {
  return viewers.find((v) => v.id === id)?.displayName ?? id;
}

function maxDate(a: DateStr, b: DateStr): DateStr {
  return a > b ? a : b;
}
