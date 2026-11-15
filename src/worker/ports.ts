// 外部とやり取りする部分のインターフェース（ポート）。
// サービスはこれらだけに依存し、実装（adapters/）は container.ts で組み立てて注入する。
// テストでは、時計・乱数・カレンダー・OAuth をフェイクに差し替える。

import type { Level, OverrideLevel, PeriodLimit, WeekStart } from '../shared/api';
import type { ColorPalette, SourceCalendar, SourceEvent, SourceLabel } from './domain/event';
import type { LabelNameRow } from './domain/labels';
import type { OverrideRow, RuleRow } from './domain/level';

// ---- 実行環境 ----

export interface Clock {
  now(): number;
}

export interface Random {
  bytes(n: number): Uint8Array;
  /** セッションなどに使う、推測できない文字列（base64url、256ビット） */
  token(): string;
}

/** 暗号化と照合用ハッシュ。鍵は Workers の Secret から作る */
export interface SecretBox {
  encrypt(plain: string): Promise<string>;
  decrypt(sealed: string): Promise<string>;
  /** 鍵付きハッシュ（HMAC）。同じ入力には同じ値を返す */
  hash(value: string): Promise<string>;
}

// ---- Google ----

export interface CalendarSource {
  listCalendars(): Promise<SourceCalendar[]>;
  listLabels(calendarId: string): Promise<SourceLabel[]>;
  getColorPalette(): Promise<ColorPalette>;
  /** [from, to) と重なる予定。繰り返し予定は回ごとに展開して返す */
  listEvents(calendarId: string, from: number, to: number): Promise<SourceEvent[]>;
}

export interface OAuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | null;
  scope: string;
}

export interface OAuthIdentity {
  email: string;
  emailVerified: boolean;
}

export interface OAuthProvider {
  /** カレンダーを読むのに必要なスコープ。トークンにこれが含まれていれば連携済みとみなす */
  readonly calendarScope: string;
  authorizationUrl(p: { redirectUri: string; state: string; codeChallenge: string; forceConsent: boolean }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens & OAuthIdentity>;
  /** 失効・取り消し済みなら OAuthRevokedError を投げる */
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
}

// ---- 保存先（D1） ----

export interface ViewerRecord {
  id: string;
  displayName: string;
  codeEnc: string;
  codeHash: string;
  status: 'active' | 'disabled';
  defaultWeekStart: WeekStart;
  /** 閲覧者が自分で選んだ週の開始曜日。未選択なら null */
  weekStart: WeekStart | null;
  period: PeriodLimit;
  createdAt: number;
  lastSeenAt: number | null;
  lastForcedRefreshAt: number | null;
}

export type ViewerPatch = Partial<
  Pick<
    ViewerRecord,
    | 'displayName'
    | 'codeEnc'
    | 'codeHash'
    | 'status'
    | 'defaultWeekStart'
    | 'weekStart'
    | 'period'
    | 'lastSeenAt'
    | 'lastForcedRefreshAt'
  >
>;

export interface ViewerRepository {
  list(): Promise<ViewerRecord[]>;
  get(id: string): Promise<ViewerRecord | null>;
  findByCodeHash(codeHash: string): Promise<ViewerRecord | null>;
  insert(v: ViewerRecord): Promise<void>;
  update(id: string, patch: ViewerPatch): Promise<void>;
  /** 表示ルール・個別設定・カテゴリ名の上書き・セッションも消す */
  delete(id: string): Promise<void>;
}

export interface RuleRepository {
  listForViewer(viewerId: string): Promise<RuleRow[]>;
  listAll(): Promise<(RuleRow & { viewerId: string })[]>;
  set(viewerId: string, calendarId: string, labelKey: string, level: Level): Promise<void>;
  replaceAll(viewerId: string, rows: RuleRow[]): Promise<void>;
}

export interface OverrideRepository {
  listForViewer(viewerId: string): Promise<OverrideRow[]>;
  listAll(): Promise<(OverrideRow & { viewerId: string })[]>;
  /** level が null なら消す */
  set(viewerId: string, calendarId: string, eventKey: string, level: OverrideLevel | null): Promise<void>;
  replaceAll(viewerId: string, rows: OverrideRow[]): Promise<void>;
}

export interface ViewerSessionRecord {
  tokenHash: string;
  viewerId: string;
  createdAt: number;
  expiresAt: number;
  renewedAt: number;
}

export interface ViewerSessionRepository {
  create(s: ViewerSessionRecord): Promise<void>;
  find(tokenHash: string): Promise<ViewerSessionRecord | null>;
  renew(tokenHash: string, expiresAt: number, renewedAt: number): Promise<void>;
  delete(tokenHash: string): Promise<void>;
  deleteForViewer(viewerId: string): Promise<void>;
}

export interface AdminSessionRecord {
  tokenHash: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminSessionRepository {
  create(s: AdminSessionRecord): Promise<void>;
  find(tokenHash: string): Promise<AdminSessionRecord | null>;
  delete(tokenHash: string): Promise<void>;
}

export interface CalendarSelectionRepository {
  list(): Promise<string[]>;
  replace(calendarIds: string[]): Promise<void>;
}

/** 全員共通のカテゴリ名の上書き */
export interface LabelNameRepository {
  list(): Promise<LabelNameRow[]>;
  /** displayName が null なら上書きを消す */
  set(calendarId: string, labelKey: string, displayName: string | null): Promise<void>;
}

/** 閲覧者ごとのカテゴリ名の上書き */
export interface ViewerLabelNameRepository {
  listForViewer(viewerId: string): Promise<LabelNameRow[]>;
  /** displayName が null なら上書きを消す */
  set(viewerId: string, calendarId: string, labelKey: string, displayName: string | null): Promise<void>;
  replaceAll(viewerId: string, rows: LabelNameRow[]): Promise<void>;
}

export interface StoredToken {
  refreshTokenEnc: string;
  accessTokenEnc: string | null;
  accessExpiresAt: number | null;
  scope: string;
  updatedAt: number;
}

export interface TokenRepository {
  get(): Promise<StoredToken | null>;
  save(t: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

export interface CacheEntry {
  fetchedAt: number;
  payload: string;
}

export interface CacheRepository {
  get(key: string): Promise<CacheEntry | null>;
  put(key: string, payload: string, fetchedAt: number): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface JoinFailureRepository {
  countSince(ip: string, since: number): Promise<number>;
  record(ip: string, at: number): Promise<void>;
  purgeBefore(at: number): Promise<void>;
}

export interface Repositories {
  viewers: ViewerRepository;
  rules: RuleRepository;
  overrides: OverrideRepository;
  viewerSessions: ViewerSessionRepository;
  adminSessions: AdminSessionRepository;
  calendarSelection: CalendarSelectionRepository;
  labelNames: LabelNameRepository;
  viewerLabelNames: ViewerLabelNameRepository;
  tokens: TokenRepository;
  cache: CacheRepository;
  joinFailures: JoinFailureRepository;
}
