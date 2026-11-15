// カレンダーの表示画面（要件 4.3）。閲覧画面と管理画面のプレビューで共通。
// データの取り出し口（CalendarFeed）と現在時刻を外から受け取る。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ViewerEvent, ViewerMe, WeekStart } from '../../shared/api';
import { addDays, type DateStr, diffDays, jstDateOf, jstMinutesOfDay } from '../../shared/time';
import type { CalendarFeed } from '../api/clients';
import { errorMessage } from '../ui/errors';
import { Modal } from '../ui/Modal';
import {
  canShift,
  clampDate,
  eventLabel,
  eventsOnDate,
  fetchRange,
  formatDateJa,
  formatEventTime,
  initialScrollMinutes,
  isBandEvent,
  layoutBand,
  layoutDay,
  monthGrid,
  normalizeAnchor,
  periodTitle,
  shiftAnchor,
  switchAnchor,
  threeWeeksGrid,
  type ViewMode,
  WEEKDAY_LABELS,
} from './layout';

/** 自動更新の間隔（要件 6章） */
const AUTO_REFRESH_MS = 5 * 60 * 1000;
/** タブに戻ったときの取り直しを、直前に取得していたら省く間隔 */
const REFETCH_MIN_INTERVAL_MS = 15 * 1000;
const PX_PER_MIN = 0.8;
/** 開いたときの表示（要件 4.3） */
const DEFAULT_VIEW: ViewMode = 'threeWeeks';

export interface CalendarScreenProps {
  feed: CalendarFeed;
  now?: () => number;
}

export function CalendarScreen({ feed, now = Date.now }: CalendarScreenProps) {
  const [me, setMe] = useState<ViewerMe | null>(null);
  const [view, setView] = useState<ViewMode>(DEFAULT_VIEW);
  const [anchor, setAnchor] = useState<DateStr | null>(null);
  const [events, setEvents] = useState<ViewerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ViewerEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<DateStr | null>(null);
  const currentTime = useNow(now);
  const lastLoadAt = useRef(0);
  const requestSeq = useRef(0);

  const today = jstDateOf(currentTime);
  const weekStart: WeekStart = me?.weekStart ?? 0;

  useEffect(() => {
    let cancelled = false;
    feed
      .me()
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        setAnchor(normalizeAnchor(DEFAULT_VIEW, jstDateOf(now()), m.weekStart));
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [feed, now]);

  const range = anchor ? fetchRange(view, anchor, weekStart) : null;
  const rangeFrom = range?.from;
  const rangeTo = range?.to;

  const load = useCallback(
    async (refresh = false) => {
      if (!rangeFrom || !rangeTo) return;
      const seq = ++requestSeq.current;
      lastLoadAt.current = Date.now();
      setLoading(true);
      try {
        const res = await feed.events(rangeFrom, rangeTo, refresh);
        if (seq !== requestSeq.current) return; // 古い応答は捨てる
        setEvents(res.events);
        setError(null);
        if (refresh) setNotice('最新の予定を読み込みました');
      } catch (e) {
        if (seq === requestSeq.current) setError(errorMessage(e));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [feed, rangeFrom, rangeTo],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 表示している間は5分ごと、タブやアプリに戻ってきたときにも取り直す
  useEffect(() => {
    const timer = setInterval(() => void load(), AUTO_REFRESH_MS);
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadAt.current > REFETCH_MIN_INTERVAL_MS) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!me || !anchor) {
    return <div className="cal-status">{error ?? '読み込み中…'}</div>;
  }

  const changeView = (next: ViewMode) => {
    if (next === view) return;
    setView(next);
    setAnchor(switchAnchor(view, next, anchor, today, weekStart, me.bounds));
  };

  const changeWeekStart = async (ws: WeekStart) => {
    try {
      const updated = feed.saveWeekStart ? await feed.saveWeekStart(ws) : { ...me, weekStart: ws };
      setMe(updated);
      setAnchor(normalizeAnchor(view, clampDate(view === 'month' ? anchor : addDays(anchor, 3), updated.bounds), ws));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const canPrev = canShift(view, anchor, -1, me.bounds);
  const canNext = canShift(view, anchor, 1, me.bounds);

  return (
    <div className="cal">
      <header className="cal-header">
        <div className="cal-title">{periodTitle(view, anchor)}</div>
        <div className="cal-toolbar">
          <button type="button" disabled={!canPrev} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))} aria-label="前へ">
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(normalizeAnchor(view, today, weekStart))}>
            今日
          </button>
          <button type="button" disabled={!canNext} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))} aria-label="次へ">
            ›
          </button>
          <div className="segmented">
            <button type="button" aria-pressed={view === 'week'} onClick={() => changeView('week')}>
              週
            </button>
            <button type="button" aria-pressed={view === 'threeWeeks'} onClick={() => changeView('threeWeeks')}>
              3週
            </button>
            <button type="button" aria-pressed={view === 'month'} onClick={() => changeView('month')}>
              月
            </button>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={loading} aria-label="更新">
            {loading ? '…' : '↻'}
          </button>
        </div>
      </header>
      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="toast">{notice}</div>}

      {view === 'week' ? (
        <WeekView anchor={anchor} events={events} now={currentTime} onSelect={setSelectedEvent} />
      ) : view === 'threeWeeks' ? (
        <DayGrid
          weeks={threeWeeksGrid(anchor)}
          today={today}
          events={events}
          maxPerCell={THREE_WEEKS_CELL_MAX}
          className="is-three-weeks"
          dayLabel={(d) => (d.endsWith('-01') ? `${Number(d.slice(5, 7))}/1` : String(Number(d.slice(8))))}
          onSelectDate={setSelectedDate}
        />
      ) : (
        <DayGrid
          weeks={monthGrid(anchor, weekStart)}
          today={today}
          events={events}
          maxPerCell={MONTH_CELL_MAX}
          isOther={(d) => d.slice(0, 7) !== anchor.slice(0, 7)}
          onSelectDate={setSelectedDate}
        />
      )}

      <footer className="cal-footer">
        <label>
          週の始まり：
          <select value={weekStart} onChange={(e) => void changeWeekStart(Number(e.target.value) as WeekStart)}>
            <option value={0}>日曜</option>
            <option value={1}>月曜</option>
          </select>
        </label>
      </footer>

      {selectedDate && (
        <Modal title={formatDateJa(selectedDate)} onClose={() => setSelectedDate(null)}>
          <DayList
            events={eventsOnDate(events, selectedDate)}
            onSelect={(e) => {
              setSelectedDate(null);
              setSelectedEvent(e);
            }}
          />
        </Modal>
      )}
      {selectedEvent && (
        <Modal title="予定" onClose={() => setSelectedEvent(null)}>
          <EventDetail event={selectedEvent} />
        </Modal>
      )}
    </div>
  );
}

function WeekView({
  anchor,
  events,
  now,
  onSelect,
}: {
  anchor: DateStr;
  events: ViewerEvent[];
  now: number;
  onSelect: (e: ViewerEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const band = layoutBand(events.filter(isBandEvent), anchor);
  const bandRows = band.reduce((n, b) => Math.max(n, b.row + 1), 0);
  const timed = events.filter((e) => !isBandEvent(e));
  const today = jstDateOf(now);
  const todayIndex = diffDays(anchor, today);

  // 週を切り替えたときだけ、開始時刻の位置までスクロールする（要件 4.3）
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = initialScrollMinutes(anchor, Date.now()) * PX_PER_MIN;
  }, [anchor]);

  return (
    <div className="week">
      <div className="week-head">
        <div className="gutter" />
        {days.map((d) => (
          <div key={d} className={`week-day ${d === today ? 'is-today' : ''}`}>
            <span className="wd">{WEEKDAY_LABELS[new Date(`${d}T00:00:00Z`).getUTCDay()]}</span>
            <span className="dn">{Number(d.slice(8))}</span>
          </div>
        ))}
      </div>
      {bandRows > 0 && (
        <div className="week-band" style={{ gridTemplateRows: `repeat(${bandRows}, 22px)` }}>
          {band.map((b) => (
            <button
              type="button"
              key={b.event.id}
              className="chip"
              style={{
                gridColumn: `${b.startCol + 2} / span ${b.span}`,
                gridRow: b.row + 1,
                background: b.event.color,
              }}
              onClick={() => onSelect(b.event)}
            >
              {eventLabel(b.event)}
            </button>
          ))}
        </div>
      )}
      <div className="week-scroll" ref={scrollRef}>
        <div className="week-grid" style={{ height: 24 * 60 * PX_PER_MIN }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label" style={{ top: h * 60 * PX_PER_MIN }}>
                {h === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>
          {days.map((d, i) => (
            <div key={d} className="day-col">
              {layoutDay(eventsOnDate(timed, d)).map((b) => (
                <button
                  type="button"
                  key={b.event.id}
                  className="block"
                  style={{
                    top: b.top * PX_PER_MIN,
                    height: b.height * PX_PER_MIN,
                    left: `${(b.column / b.columns) * 100}%`,
                    width: `${100 / b.columns}%`,
                    background: b.event.color,
                  }}
                  onClick={() => onSelect(b.event)}
                >
                  {eventLabel(b.event)}
                </button>
              ))}
              {i === todayIndex && <div className="now-line" style={{ top: jstMinutesOfDay(now) * PX_PER_MIN }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MONTH_CELL_MAX = 3;
/** 3週間表示は行が月表示より少なくマスが高いので、1マスに多く出す */
const THREE_WEEKS_CELL_MAX = 6;

/** 月表示・3週間表示のマス目。日付をタップすると、その日の予定一覧を出す */
function DayGrid({
  weeks,
  today,
  events,
  maxPerCell,
  className = '',
  isOther = () => false,
  dayLabel = (d) => String(Number(d.slice(8))),
  onSelectDate,
}: {
  weeks: DateStr[][];
  today: DateStr;
  events: ViewerEvent[];
  maxPerCell: number;
  className?: string;
  /** 薄く表示する日（月表示の前後の月の日） */
  isOther?: (d: DateStr) => boolean;
  dayLabel?: (d: DateStr) => string;
  onSelectDate: (d: DateStr) => void;
}) {
  return (
    <div className={`month ${className}`}>
      <div className="month-head">
        {weeks[0]!.map((d) => (
          <div key={d}>{WEEKDAY_LABELS[new Date(`${d}T00:00:00Z`).getUTCDay()]}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="month-week">
          {week.map((d) => {
            const dayEvents = sortForDay(eventsOnDate(events, d));
            return (
              <button
                type="button"
                key={d}
                className={`month-cell ${isOther(d) ? 'is-other' : ''} ${d === today ? 'is-today' : ''}`}
                onClick={() => onSelectDate(d)}
              >
                <span className="dn">{dayLabel(d)}</span>
                {dayEvents.slice(0, maxPerCell).map((e) => (
                  <span key={e.id} className="mini" style={{ background: e.color }}>
                    {eventLabel(e)}
                  </span>
                ))}
                {dayEvents.length > maxPerCell && <span className="more">+{dayEvents.length - maxPerCell}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function sortForDay(events: ViewerEvent[]): ViewerEvent[] {
  return [...events].sort((a, b) => Number(isBandEvent(b)) - Number(isBandEvent(a)) || a.start - b.start);
}

function DayList({ events, onSelect }: { events: ViewerEvent[]; onSelect: (e: ViewerEvent) => void }) {
  if (events.length === 0) return <p className="muted">予定はありません</p>;
  return (
    <ul className="day-list">
      {sortForDay(events).map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => onSelect(e)}>
            <span className="swatch" style={{ background: e.color }} />
            <span className="day-list-text">
              <span>{eventLabel(e)}</span>
              <span className="muted small">{formatEventTime(e)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 予定の詳細。表示レベルで見せてよい範囲だけを出す（要件 4.3） */
function EventDetail({ event }: { event: ViewerEvent }) {
  return (
    <div className="event-detail">
      <div className="event-detail-title">
        <span className="swatch" style={{ background: event.color }} />
        <strong>{eventLabel(event)}</strong>
      </div>
      <p>{formatEventTime(event)}</p>
      {event.level === 'detail' && <p className="muted">カテゴリ：{event.category}</p>}
    </div>
  );
}

/** 現在時刻を1分ごとに更新する */
function useNow(now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setT(now()), 60 * 1000);
    return () => clearInterval(id);
  }, [now]);
  return t;
}
