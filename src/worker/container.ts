// 依存の組み立て（コンポジションルート）。実装の選択はここだけで行う。
// 本番は buildServices(env)、テストは assembleServices にフェイクを渡して、同じ組み立て方を使う。

import { createD1Repositories } from './adapters/d1';
import { FakeCalendarSource, FakeOAuthProvider } from './adapters/fake';
import { GoogleCalendarSource, GoogleOAuthProvider } from './adapters/google';
import { createSecretBox, cryptoRandom, systemClock } from './adapters/runtime';
import type { AppEnv } from './env';
import type { CalendarSource, Clock, OAuthProvider, Random, Repositories, SecretBox } from './ports';
import { AdminAuthService } from './services/adminAuth';
import { AdminCalendarService } from './services/adminCalendar';
import { AdminViewerService } from './services/adminViewers';
import { CalendarData } from './services/calendarData';
import { FeedService } from './services/feed';
import { TokenProvider } from './services/tokenProvider';
import { ViewerAccessService } from './services/viewerAccess';

export type Mode = 'google' | 'fake';

export interface Services {
  mode: Mode;
  viewerAccess: ViewerAccessService;
  feed: FeedService;
  adminViewers: AdminViewerService;
  adminCalendar: AdminCalendarService;
  adminAuth: AdminAuthService;
}

export interface Infrastructure {
  mode: Mode;
  repos: Repositories;
  clock: Clock;
  random: Random;
  secretBox: SecretBox;
  oauth: OAuthProvider;
  adminEmail: string;
  /** アクセストークンの取り出し方を受け取って、カレンダーの読み出し口を作る */
  createCalendarSource(accessToken: () => Promise<string>): CalendarSource;
}

export function assembleServices(infra: Infrastructure): Services {
  const { repos, clock, random, secretBox, oauth } = infra;
  const tokens = new TokenProvider({ tokens: repos.tokens, oauth, secretBox, clock });
  const data = new CalendarData({
    source: infra.createCalendarSource(() => tokens.accessToken()),
    cache: repos.cache,
    selection: repos.calendarSelection,
    labelNames: repos.labelNames,
    clock,
  });
  return {
    mode: infra.mode,
    viewerAccess: new ViewerAccessService({ repos, secretBox, random, clock }),
    feed: new FeedService({ repos, data, clock }),
    adminViewers: new AdminViewerService({ repos, secretBox, random, clock }),
    adminCalendar: new AdminCalendarService({ repos, data, clock }),
    adminAuth: new AdminAuthService({ repos, oauth, secretBox, random, clock, adminEmail: infra.adminEmail }),
  };
}

export async function buildServices(env: AppEnv): Promise<Services> {
  const mode: Mode = env.CALENDAR_SOURCE === 'fake' ? 'fake' : 'google';
  if (!env.ADMIN_EMAIL) throw new Error('ADMIN_EMAIL が設定されていません');
  const secretBox = await secretBoxFor(env.ENCRYPTION_KEY);

  let oauth: OAuthProvider;
  let createCalendarSource: Infrastructure['createCalendarSource'];
  if (mode === 'fake') {
    oauth = new FakeOAuthProvider(env.ADMIN_EMAIL);
    const fake = new FakeCalendarSource();
    createCalendarSource = () => fake;
  } else {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET が設定されていません');
    }
    oauth = new GoogleOAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.ADMIN_EMAIL);
    createCalendarSource = (accessToken) => new GoogleCalendarSource(accessToken);
  }

  return assembleServices({
    mode,
    repos: createD1Repositories(env.DB),
    clock: systemClock,
    random: cryptoRandom,
    secretBox,
    oauth,
    adminEmail: env.ADMIN_EMAIL,
    createCalendarSource,
  });
}

// 鍵の導出（HKDF）をリクエストごとに繰り返さないよう、同じ isolate の中で使い回す
let secretBoxCache: { key: string; box: Promise<SecretBox> } | null = null;

function secretBoxFor(key: string | undefined): Promise<SecretBox> {
  if (!key) throw new Error('ENCRYPTION_KEY が設定されていません');
  if (secretBoxCache?.key !== key) secretBoxCache = { key, box: createSecretBox(key, cryptoRandom) };
  return secretBoxCache.box;
}
