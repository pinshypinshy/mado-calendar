// ローカル開発とテスト用のフェイク。Google につながずに画面と API を試せるようにする。
// CALENDAR_SOURCE=fake のときだけ使い、localhost 以外では起動しない（index.ts で確認する）。

import { addDays, type DateStr, jstDateOf, jstMidnight, splitDate, weekdayOf } from '../../shared/time';
import type { SourceCalendar, SourceEvent, SourceLabel } from '../domain/event';
import { overlapsWindow } from '../domain/period';
import type { CalendarSource, OAuthProvider } from '../ports';
import { CALENDAR_SCOPE } from './google';

export const FAKE_MAIN = 'fake-main';
export const FAKE_CLASS = 'fake-class';
export const FAKE_OTHER = 'fake-other';

const CALENDARS: SourceCalendar[] = [
  { id: FAKE_MAIN, name: 'メイン（フェイク）', color: '#039be5' },
  { id: FAKE_CLASS, name: '授業（フェイク）', color: '#f6bf26' },
  { id: FAKE_OTHER, name: '共有されたカレンダー（フェイク）', color: '#0b8043' },
];

const LABELS: Record<string, SourceLabel[]> = {
  [FAKE_MAIN]: [
    { id: 'lbl-other', name: 'その他の予定', color: '#7986cb' },
    { id: 'lbl-clinic', name: '通院・美容院の予定', color: '#33b679' },
    { id: 'lbl-job', name: '就活の予定', color: '#8e24aa' },
    { id: 'lbl-private', name: 'プライベートの予定', color: '#e67c73' },
    { id: 'lbl-friends', name: '友達との予定', color: '#f4511e' },
    { id: 'lbl-shift', name: 'アルバイトのシフト', color: '#039be5' },
    { id: 'lbl-family', name: '家族との予定', color: '#3f51b5' },
    { id: 'lbl-deadline', name: '締め切り・メモ', color: '#0b8043' },
    { id: 'lbl-lemon', name: '', color: '#e4c441' },
  ],
  [FAKE_CLASS]: [
    { id: 'lbl-attend', name: '出席あり', color: '#f6bf26' },
    { id: 'lbl-noattend', name: '出席なし', color: '#e4c441' },
  ],
  [FAKE_OTHER]: [],
};

interface Template {
  calendarId: string;
  /** 繰り返し予定ならシリーズの ID */
  series?: string;
  id: string;
  title: string;
  /** "HH:MM"。終日の予定なら省略 */
  start?: string;
  end?: string;
  /** 終日・複数日の予定の日数 */
  days?: number;
  /** 終了時刻が翌日になる予定 */
  endsNextDay?: boolean;
  eventLabelId?: string;
  colorId?: string;
}

/** その日にある予定のひな形。日付から決まるので、何度呼んでも同じ結果になる */
function templatesOn(date: DateStr): Template[] {
  const wd = weekdayOf(date);
  const day = splitDate(date)[2];
  const t: Template[] = [];
  const main = FAKE_MAIN;
  const cls = FAKE_CLASS;

  // 繰り返し予定：アルバイトのシフト（火・木・土）
  if (wd === 2 || wd === 4 || wd === 6) {
    t.push({ calendarId: main, series: 'shift', id: 'shift', title: 'アルバイト', start: '17:00', end: '22:00', eventLabelId: 'lbl-shift', colorId: '7' });
  }
  // 繰り返し予定：外出（日）
  if (wd === 0) {
    t.push({ calendarId: main, series: 'outing', id: 'outing', title: '外出', start: '13:00', end: '18:00', eventLabelId: 'lbl-private', colorId: '4' });
  }
  // 日をまたぐ予定（金）→ 週表示では上部の帯に出る
  if (wd === 5) {
    t.push({ calendarId: main, id: 'drink', title: '友達と飲み', start: '22:00', end: '01:00', endsNextDay: true, eventLabelId: 'lbl-friends', colorId: '6' });
  }
  // 重なる予定（水）
  if (wd === 3) {
    t.push({ calendarId: main, id: 'lunch', title: 'ランチ', start: '12:00', end: '13:00' });
    t.push({ calendarId: main, id: 'prep', title: 'ゼミ準備', start: '12:30', end: '14:00', eventLabelId: 'lbl-lemon' });
  }
  // eventLabelId がなく colorId だけの予定（ラベル ID が返らない場合の判定を確かめるため）
  if (day === 3 || day === 12 || day === 21) {
    t.push({ calendarId: main, id: 'interview', title: '一次面接', start: '14:00', end: '15:00', colorId: '3' });
  }
  // # ルールの対象
  if (day === 8 || day === 18) {
    t.push({ calendarId: main, id: 'clinic', title: '#歯医者', start: '10:00', end: '11:00', eventLabelId: 'lbl-clinic', colorId: '2' });
  }
  // 終日の予定
  if (day === 1) {
    t.push({ calendarId: main, id: 'deadline', title: 'レポート締め切り', days: 1, eventLabelId: 'lbl-deadline', colorId: '10' });
  }
  // 複数日にまたがる終日の予定
  if (day === 24) {
    t.push({ calendarId: main, id: 'trip', title: '家族旅行', days: 3, eventLabelId: 'lbl-family', colorId: '9' });
  }
  // 授業カレンダー
  if (wd === 1 || wd === 3 || wd === 5) {
    t.push({ calendarId: cls, series: 'c-info', id: 'c-info', title: '情報理論', start: '09:00', end: '10:40', eventLabelId: 'lbl-attend', colorId: '5' });
  }
  if (wd === 2) {
    t.push({ calendarId: cls, series: 'c-db', id: 'c-db', title: 'データベース', start: '13:00', end: '14:40', eventLabelId: 'lbl-noattend', colorId: '11' });
  }
  // 対象外のカレンダー
  if (wd === 4) {
    t.push({ calendarId: FAKE_OTHER, id: 'other', title: '共有の予定', start: '10:00', end: '11:00' });
  }
  return t;
}

function materialize(date: DateStr, t: Template): SourceEvent {
  const compact = date.replace(/-/g, '');
  const at = (d: DateStr, hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return jstMidnight(d) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
  };
  const allDay = t.start === undefined;
  return {
    calendarId: t.calendarId,
    id: t.series ? `${t.series}_${compact}` : `${t.id}_${compact}`,
    recurringEventId: t.series ?? null,
    title: t.title,
    start: allDay ? jstMidnight(date) : at(date, t.start!),
    end: allDay ? jstMidnight(addDays(date, t.days ?? 1)) : at(t.endsNextDay ? addDays(date, 1) : date, t.end!),
    allDay,
    eventLabelId: t.eventLabelId ?? null,
    colorId: t.colorId ?? null,
  };
}

export class FakeCalendarSource implements CalendarSource {
  /** テストで、Google を何回呼んだかを数えるため */
  calls = { listCalendars: 0, listLabels: 0, listEvents: 0 };

  async listCalendars(): Promise<SourceCalendar[]> {
    this.calls.listCalendars++;
    return CALENDARS.map((c) => ({ ...c }));
  }

  async listLabels(calendarId: string): Promise<SourceLabel[]> {
    this.calls.listLabels++;
    return (LABELS[calendarId] ?? []).map((l) => ({ ...l }));
  }


  async listEvents(calendarId: string, from: number, to: number): Promise<SourceEvent[]> {
    this.calls.listEvents++;
    const events: SourceEvent[] = [];
    // 前の日に始まって範囲にかかる予定も拾うため、数日前から見る
    for (let d = addDays(jstDateOf(from), -3); jstMidnight(d) < to; d = addDays(d, 1)) {
      for (const t of templatesOn(d)) {
        if (t.calendarId !== calendarId) continue;
        const e = materialize(d, t);
        if (overlapsWindow(e, { start: from, end: to })) events.push(e);
      }
    }
    return events.sort((a, b) => a.start - b.start);
  }
}

/**
 * Google にリダイレクトせず、そのままログインできる OAuth。
 * loginHint（/auth/login?as=メールアドレス）で、どのアカウントとしてログインするかを選べる。省略すると運営者。
 */
export class FakeOAuthProvider implements OAuthProvider {
  readonly calendarScope = CALENDAR_SCOPE;

  constructor(private readonly defaultEmail: string) {}

  authorizationUrl(p: { redirectUri: string; state: string; loginHint: string | null }): string {
    const code = `fake:${p.loginHint ?? this.defaultEmail}`;
    return `${p.redirectUri}?${new URLSearchParams({ code, state: p.state }).toString()}`;
  }

  async exchangeCode(p: { code: string }) {
    const email = p.code.startsWith('fake:') ? p.code.slice('fake:'.length) : this.defaultEmail;
    return {
      accessToken: 'fake-access-token',
      expiresIn: 3600,
      refreshToken: 'fake-refresh-token',
      scope: `openid email ${CALENDAR_SCOPE}`,
      email,
      emailVerified: true,
    };
  }

  async refresh() {
    return { accessToken: 'fake-access-token', expiresIn: 3600 };
  }
}
