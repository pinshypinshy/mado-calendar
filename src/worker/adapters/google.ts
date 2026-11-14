// Google Calendar API と Google OAuth の実装。
// 仕様の出典：
// - https://developers.google.com/workspace/calendar/api/v3/reference
// - https://developers.google.com/workspace/calendar/api/guides/labels
// - https://developers.google.com/identity/protocols/oauth2/web-server

import { jstMidnight } from '../../shared/time';
import type { ColorPalette, SourceCalendar, SourceEvent, SourceLabel } from '../domain/event';
import { AppError, OAuthRevokedError } from '../errors';
import { decodeJwtPayload } from '../lib/encoding';
import type { CalendarSource, OAuthProvider } from '../ports';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_SCOPES = ['openid', 'email', CALENDAR_SCOPE];

/** 1回の取得で読むページ数の上限。サブリクエスト数（無料プランは1回の処理につき50件）を守るため */
const MAX_PAGES = 4;

type Fetch = typeof fetch;

export class GoogleCalendarSource implements CalendarSource {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetcher: Fetch = fetch,
  ) {}

  async listCalendars(): Promise<SourceCalendar[]> {
    const items = await this.paginate<GoogleCalendarListEntry>('/users/me/calendarList', {
      fields: 'items(id,summary,summaryOverride,backgroundColor),nextPageToken',
    });
    return items.map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor ?? '#9e9e9e',
    }));
  }

  async listLabels(calendarId: string): Promise<SourceLabel[]> {
    // labelProperties は calendars.get の Calendars リソースに含まれる。
    // 読み取りに eventLabelVersion=1 が必要かは公式に明記がない（未検証：要件 10章 #1）
    const res = await this.get<GoogleCalendar>(`/calendars/${encodeURIComponent(calendarId)}`, {
      fields: 'labelProperties',
    });
    return (res.labelProperties?.eventLabels ?? []).map((l) => ({
      id: l.id,
      name: l.name ?? '',
      color: l.backgroundColor,
    }));
  }

  async getColorPalette(): Promise<ColorPalette> {
    const res = await this.get<{ event?: Record<string, { background: string }> }>('/colors', { fields: 'event' });
    const palette: ColorPalette = {};
    for (const [id, c] of Object.entries(res.event ?? {})) palette[id] = c.background;
    return palette;
  }

  async listEvents(calendarId: string, from: number, to: number): Promise<SourceEvent[]> {
    const items = await this.paginate<GoogleEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      timeZone: 'Asia/Tokyo',
      maxResults: '2500',
      // 説明欄・場所・参加者などは取得しない（要件 7.1）
      fields: 'items(id,recurringEventId,summary,start,end,colorId,eventLabelId,status),nextPageToken',
    });
    const events: SourceEvent[] = [];
    for (const item of items) {
      const e = normalizeGoogleEvent(calendarId, item);
      if (e) events.push(e);
    }
    return events;
  }

  private async paginate<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const all: T[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.get<{ items?: T[]; nextPageToken?: string }>(path, {
        ...params,
        ...(pageToken ? { pageToken } : {}),
      });
      all.push(...(res.items ?? []));
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return all;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${CALENDAR_API}${path}?${new URLSearchParams(params).toString()}`;
    const res = await this.fetcher(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Google Calendar API error ${res.status} ${path}: ${body.slice(0, 500)}`);
      throw new AppError('upstream_error', `Google カレンダーから予定を取得できませんでした（${res.status}）`);
    }
    return (await res.json()) as T;
  }
}

export function normalizeGoogleEvent(calendarId: string, item: GoogleEvent): SourceEvent | null {
  if (item.status === 'cancelled') return null;
  const start = parseGoogleTime(item.start);
  const end = parseGoogleTime(item.end);
  if (!start || !end) return null;
  return {
    calendarId,
    id: item.id,
    recurringEventId: item.recurringEventId ?? null,
    title: item.summary ?? '',
    start: start.ms,
    end: end.ms,
    allDay: start.allDay,
    eventLabelId: item.eventLabelId || null,
    colorId: item.colorId || null,
  };
}

function parseGoogleTime(t: GoogleEventTime | undefined): { ms: number; allDay: boolean } | null {
  if (!t) return null;
  if (t.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : { ms, allDay: false };
  }
  // 終日の予定の date は、タイムゾーン Asia/Tokyo 固定（要件 2章）として扱う
  if (t.date) return { ms: jstMidnight(t.date), allDay: true };
  return null;
}

export class GoogleOAuthProvider implements OAuthProvider {
  readonly calendarScope = CALENDAR_SCOPE;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly loginHint: string | null,
    private readonly fetcher: Fetch = fetch,
  ) {}

  authorizationUrl(p: { redirectUri: string; state: string; codeChallenge: string; forceConsent: boolean }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      // リフレッシュトークンをまだ持っていないときだけ同意画面を出し、確実に受け取る
      prompt: p.forceConsent ? 'consent select_account' : 'select_account',
    });
    if (this.loginHint) params.set('login_hint', this.loginHint);
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }) {
    const json = await this.postToken({
      grant_type: 'authorization_code',
      code: p.code,
      code_verifier: p.codeVerifier,
      redirect_uri: p.redirectUri,
    });
    if (!json.id_token) throw new AppError('upstream_error', 'Google から ID トークンが返りませんでした');
    // トークンエンドポイントから TLS で直接受け取った ID トークンなので、署名の検証は省略できる
    // （OpenID Connect Core 1.0 の 3.1.3.7）。発行者と宛先は確認する。
    const claims = decodeJwtPayload(json.id_token);
    const iss = claims['iss'];
    if ((iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') || claims['aud'] !== this.clientId) {
      throw new AppError('forbidden', 'ID トークンの発行者または宛先が一致しません');
    }
    return {
      accessToken: json.access_token,
      expiresIn: json.expires_in,
      refreshToken: json.refresh_token ?? null,
      scope: json.scope ?? '',
      email: String(claims['email'] ?? ''),
      emailVerified: claims['email_verified'] === true,
    };
  }

  async refresh(refreshToken: string) {
    const json = await this.postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return { accessToken: json.access_token, expiresIn: json.expires_in };
  }

  private async postToken(params: Record<string, string>): Promise<GoogleTokenResponse> {
    const res = await this.fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.clientId, client_secret: this.clientSecret }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & { error?: string };
    if (!res.ok) {
      if (json.error === 'invalid_grant' && params['grant_type'] === 'refresh_token') throw new OAuthRevokedError();
      console.error(`Google token endpoint error ${res.status}: ${json.error ?? ''}`);
      throw new AppError('upstream_error', `Google との連携でエラーが発生しました（${res.status}）`);
    }
    return json as GoogleTokenResponse;
  }
}

// ---- Google の API のレスポンスの型（必要な項目だけ） ----

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
}

interface GoogleCalendar {
  labelProperties?: { eventLabels?: { id: string; name?: string; backgroundColor: string }[] };
}

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
}

export interface GoogleEvent {
  id: string;
  recurringEventId?: string;
  summary?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  colorId?: string;
  eventLabelId?: string;
  status?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}
