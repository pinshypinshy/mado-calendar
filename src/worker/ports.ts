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
  authorizationUrl(p: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
    forceConsent: boolean;
    /** ログインするアカウントの候補（Google の login_hint） */
    loginHint: string | null;
  }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens & OAuthIdentity>;
  /** 失効・取り消し済みなら OAuthRevokedError を投げる */
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
}

// ---- 保存先（D1） ----
//
// オーナー間のデータの分離（要件 7.6）は、型で守る。
// - オーナーのデータを読み書きするサービスには、OwnerRepositories（作る時点でオーナーが固定されたもの）だけを渡す。
//   メソッドにオーナーを指定する引数はなく、ほかのオーナーのデータには届かない。
// - オーナーをまたぐ処理（ログイン、閲覧者 ID での参加、運営者によるオーナーの管理）だけが GlobalRepositories を使う。

export interface OwnerRecord {
  id: string;
  /** 小文字にそろえたメールアドレス */
  email: string;
  displayName: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface ViewerRecord {
  id: string;
  ownerId: string;
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

/** 閲覧者を作るときの値。オーナーは、リポジトリの絞り込みから決まる */
export type NewViewer = Omit<ViewerRecord, 'ownerId'>;

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

// ---- オーナーで絞り込んだ保存先 ----

export interface ViewerRepository {
  list(): Promise<ViewerRecord[]>;
  /** ほかのオーナーの閲覧者なら null */
  get(id: string): Promise<ViewerRecord | null>;
  insert(v: NewViewer): Promise<void>;
  update(id: string, patch: ViewerPatch): Promise<void>;
  /** 表示ルール・個別設定・カテゴリ名の上書き・セッションも消す */
  delete(id: string): Promise<void>;
  /** その閲覧者が参加済みの端末を、すべて表示できなくする */
  deleteSessions(id: string): Promise<void>;
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

/** 1人のオーナーに絞り込んだ保存先 */
export interface OwnerRepositories {
  readonly ownerId: string;
  viewers: ViewerRepository;
  rules: RuleRepository;
  overrides: OverrideRepository;
  calendarSelection: CalendarSelectionRepository;
  labelNames: LabelNameRepository;
  viewerLabelNames: ViewerLabelNameRepository;
  tokens: TokenRepository;
  cache: CacheRepository;
}

// ---- オーナーをまたぐ保存先 ----

export interface OwnerRepository {
  list(): Promise<OwnerRecord[]>;
  get(id: string): Promise<OwnerRecord | null>;
  findByEmail(email: string): Promise<OwnerRecord | null>;
  insert(o: OwnerRecord): Promise<void>;
  updateDisplayName(id: string, displayName: string): Promise<void>;
  touchLogin(id: string, at: number): Promise<void>;
  /** オーナーと、そのオーナーのデータをすべて消す（要件 3.10） */
  delete(id: string): Promise<void>;
}

export interface OwnerSessionRecord {
  tokenHash: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
}

export interface OwnerSessionRepository {
  create(s: OwnerSessionRecord): Promise<void>;
  find(tokenHash: string): Promise<OwnerSessionRecord | null>;
  delete(tokenHash: string): Promise<void>;
}

/** 閲覧者 ID での参加と、閲覧者のセッションから閲覧者を引くための読み取り口（全オーナーが対象） */
export interface ViewerDirectory {
  get(id: string): Promise<ViewerRecord | null>;
  findByCodeHash(codeHash: string): Promise<ViewerRecord | null>;
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
}

export interface JoinFailureRepository {
  countSince(ip: string, since: number): Promise<number>;
  record(ip: string, at: number): Promise<void>;
  purgeBefore(at: number): Promise<void>;
}

export interface GlobalRepositories {
  owners: OwnerRepository;
  ownerSessions: OwnerSessionRepository;
  viewerDirectory: ViewerDirectory;
  viewerSessions: ViewerSessionRepository;
  joinFailures: JoinFailureRepository;
}

export interface RepositoryFactory {
  global: GlobalRepositories;
  /** 1人のオーナーに絞り込んだ保存先を作る */
  forOwner(ownerId: string): OwnerRepositories;
}
