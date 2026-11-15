// 依存の組み立て（コンポジションルート）。実装の選択はここだけで行う。
// 本番は buildServices(env)、テストは assembleServices にフェイクを渡して、同じ組み立て方を使う。
//
// オーナー間のデータの分離（要件 7.6）：
// - forOwner(ownerId) で作るサービスには、そのオーナーに絞り込んだリポジトリだけを渡す。
// - オーナーをまたぐリポジトリ（GlobalRepositories）を受け取るのは、ログイン・参加・運営者の処理だけ。

import { createD1Repositories } from './adapters/d1';
import { FakeCalendarSource, FakeOAuthProvider } from './adapters/fake';
import { GoogleCalendarSource, GoogleOAuthProvider } from './adapters/google';
import { createSecretBox, cryptoRandom, systemClock } from './adapters/runtime';
import type { AppEnv } from './env';
import type { CalendarSource, Clock, OAuthProvider, Random, RepositoryFactory, SecretBox } from './ports';
import { AdminCalendarService } from './services/adminCalendar';
import { AdminViewerService } from './services/adminViewers';
import { CalendarData } from './services/calendarData';
import { FeedService } from './services/feed';
import { OperatorService } from './services/operator';
import { OwnerAuthService } from './services/ownerAuth';
import { OwnerProfileService } from './services/ownerProfile';
import { TokenProvider } from './services/tokenProvider';
import { ViewerAccessService } from './services/viewerAccess';

export type Mode = 'google' | 'fake';

/** 1人のオーナーのデータだけを扱うサービス */
export interface OwnerServices {
  ownerId: string;
  feed: FeedService;
  adminViewers: AdminViewerService;
  adminCalendar: AdminCalendarService;
  profile: OwnerProfileService;
}

export interface Services {
  mode: Mode;
  viewerAccess: ViewerAccessService;
  ownerAuth: OwnerAuthService;
  operator: OperatorService;
  forOwner(ownerId: string): OwnerServices;
}

export interface Infrastructure {
  mode: Mode;
  repos: RepositoryFactory;
  clock: Clock;
  random: Random;
  secretBox: SecretBox;
  oauth: OAuthProvider;
  operatorEmail: string;
  /** アクセストークンの取り出し方を受け取って、カレンダーの読み出し口を作る */
  createCalendarSource(accessToken: () => Promise<string>): CalendarSource;
}

export function assembleServices(infra: Infrastructure): Services {
  const { repos, clock, random, secretBox, oauth, operatorEmail } = infra;
  const global = repos.global;
  const forOwnerRepos = (ownerId: string) => repos.forOwner(ownerId);

  return {
    mode: infra.mode,
    viewerAccess: new ViewerAccessService({ global, forOwner: forOwnerRepos, secretBox, random, clock }),
    ownerAuth: new OwnerAuthService({ global, forOwner: forOwnerRepos, oauth, secretBox, random, clock, operatorEmail }),
    operator: new OperatorService({ global, random, clock, operatorEmail }),
    forOwner(ownerId) {
      const own = repos.forOwner(ownerId);
      const tokens = new TokenProvider({ tokens: own.tokens, oauth, secretBox, clock });
      const data = new CalendarData({
        source: infra.createCalendarSource(() => tokens.accessToken()),
        cache: own.cache,
        selection: own.calendarSelection,
        labelNames: own.labelNames,
        clock,
      });
      return {
        ownerId,
        feed: new FeedService({ repos: own, data, clock }),
        adminViewers: new AdminViewerService({ repos: own, secretBox, random, clock }),
        adminCalendar: new AdminCalendarService({ repos: own, data, clock }),
        // オーナーの行の読み書きは、このオーナーに固定した口だけを渡す
        profile: new OwnerProfileService({
          get: () => global.owners.get(ownerId),
          setDisplayName: (name) => global.owners.updateDisplayName(ownerId, name),
        }),
      };
    },
  };
}

export async function buildServices(env: AppEnv): Promise<Services> {
  const mode: Mode = env.CALENDAR_SOURCE === 'fake' ? 'fake' : 'google';
  if (!env.OPERATOR_EMAIL) throw new Error('OPERATOR_EMAIL が設定されていません');
  const secretBox = await secretBoxFor(env.ENCRYPTION_KEY);

  let oauth: OAuthProvider;
  let createCalendarSource: Infrastructure['createCalendarSource'];
  if (mode === 'fake') {
    oauth = new FakeOAuthProvider(env.OPERATOR_EMAIL);
    const fake = new FakeCalendarSource();
    createCalendarSource = () => fake;
  } else {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new Error('GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET が設定されていません');
    }
    oauth = new GoogleOAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    createCalendarSource = (accessToken) => new GoogleCalendarSource(accessToken);
  }

  return assembleServices({
    mode,
    repos: createD1Repositories(env.DB),
    clock: systemClock,
    random: cryptoRandom,
    secretBox,
    oauth,
    operatorEmail: env.OPERATOR_EMAIL,
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
