// 閲覧者の画面（要件 4章）。
// 1台の端末で複数のオーナーに参加でき、画面の上部で表示するオーナーを切り替える（要件 4.6）。

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { MembershipsResponse } from '../../shared/api';
import type { ViewerApi } from '../api/clients';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { errorMessage, isUnauthorized } from '../ui/errors';
import { Modal } from '../ui/Modal';

export interface ViewerAppProps {
  api: ViewerApi;
  /** 招待 URL（/join#ID）で開いたときの ID */
  inviteCode: string | null;
  standalone: boolean;
  inAppBrowser: boolean;
  /** 参加したあとに URL から ID を消す */
  clearInviteFromUrl: () => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'joined'; memberships: MembershipsResponse }
  | { kind: 'join'; error: string | null }
  | { kind: 'error'; message: string };

export function ViewerApp({ api, inviteCode, standalone, inAppBrowser, clearInviteFromUrl }: ViewerAppProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  /** 招待 URL で参加できなかったが、ほかのオーナーには参加済みのときのお知らせ */
  const [notice, setNotice] = useState<string | null>(null);

  const loadMemberships = useCallback(async (): Promise<State> => {
    try {
      return { kind: 'joined', memberships: await api.memberships() };
    } catch (e) {
      return isUnauthorized(e) ? { kind: 'join', error: null } : { kind: 'error', message: errorMessage(e) };
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // アプリ内ブラウザでは参加しない。「Safari で開く」で URL（ID を含む）をそのまま Safari に渡すため
      if (inviteCode && !inAppBrowser) {
        try {
          await api.join(inviteCode);
        } catch (e) {
          clearInviteFromUrl();
          const next = await loadMemberships();
          // すでにほかのオーナーに参加している場合は、その画面を出したうえでエラーを伝える
          if (cancelled) return;
          setState(next.kind === 'joined' ? next : { kind: 'join', error: errorMessage(e) });
          if (next.kind === 'joined') setNotice(`招待 URL で参加できませんでした：${errorMessage(e)}`);
          return;
        }
        clearInviteFromUrl();
      }
      const next = await loadMemberships();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, inviteCode, inAppBrowser, clearInviteFromUrl, loadMemberships, attempt]);

  const onJoined = useCallback(async () => {
    setAdding(false);
    setState(await loadMemberships());
  }, [loadMemberships]);

  const select = useCallback(
    async (viewerId: string) => {
      if (state.kind !== 'joined') return;
      setState({ kind: 'joined', memberships: { ...state.memberships, current: viewerId } });
      await api.select(viewerId).catch(() => {});
    },
    [api, state],
  );

  const current = state.kind === 'joined' ? state.memberships.current : null;
  const feed = useMemo(() => (current ? api.feed(current) : null), [api, current]);

  return (
    <div className="viewer">
      <Guidance standalone={standalone} inAppBrowser={inAppBrowser} />
      {notice && (
        <div className="banner banner-error">
          <span>{notice}</span>
          <button type="button" className="icon" onClick={() => setNotice(null)} aria-label="閉じる">
            ×
          </button>
        </div>
      )}
      {state.kind === 'loading' && <div className="cal-status">読み込み中…</div>}
      {state.kind === 'error' && (
        <div className="center-box">
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === 'join' && !(inAppBrowser && inviteCode) && (
        <JoinForm api={api} initialError={state.error} onJoined={() => void onJoined()} />
      )}
      {state.kind === 'joined' && feed && (
        <>
          <OwnerSwitcher memberships={state.memberships} onSelect={(id) => void select(id)} onAdd={() => setAdding(true)} />
          <CalendarScreen key={state.memberships.current} feed={feed} />
        </>
      )}
      {adding && (
        <Modal title="ほかの人のカレンダーを追加" onClose={() => setAdding(false)}>
          <JoinForm api={api} initialError={null} onJoined={() => void onJoined()} compact />
        </Modal>
      )}
    </div>
  );
}

/** 参加しているオーナーの切り替え。1人だけなら名前と追加ボタンだけを出す */
function OwnerSwitcher({
  memberships,
  onSelect,
  onAdd,
}: {
  memberships: MembershipsResponse;
  onSelect: (viewerId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="owner-switcher">
      {memberships.memberships.length > 1 ? (
        <div className="owner-tabs" role="tablist" aria-label="表示するカレンダー">
          {memberships.memberships.map((m) => (
            <button
              type="button"
              role="tab"
              key={m.viewerId}
              aria-selected={m.viewerId === memberships.current}
              onClick={() => onSelect(m.viewerId)}
            >
              {m.ownerName}
            </button>
          ))}
        </div>
      ) : (
        <span className="owner-name">{memberships.memberships[0]?.ownerName} のカレンダー</span>
      )}
      <button type="button" className="icon" onClick={onAdd} aria-label="ほかの人のカレンダーを追加">
        ＋
      </button>
    </div>
  );
}

/** ホーム画面への追加の案内（要件 4.2） */
function Guidance({ standalone, inAppBrowser }: { standalone: boolean; inAppBrowser: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (inAppBrowser) {
    return (
      <div className="banner banner-warn">
        LINE などのアプリの中では、正しく表示できないことがあります。画面のメニュー（… や共有ボタン）から
        <strong>「Safari で開く」</strong>を選んでください。
      </div>
    );
  }
  if (standalone || dismissed) return null;
  return (
    <div className="banner">
      <span>
        Safari の<strong>共有ボタン</strong>から<strong>「ホーム画面に追加」</strong>を選ぶと、アプリのように使えます。
      </span>
      <button type="button" className="icon" onClick={() => setDismissed(true)} aria-label="閉じる">
        ×
      </button>
    </div>
  );
}

function JoinForm({
  api,
  initialError,
  onJoined,
  compact = false,
}: {
  api: ViewerApi;
  initialError: string | null;
  onJoined: () => void;
  compact?: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.join(code);
      onJoined();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={compact ? 'join join-compact' : 'center-box join'} onSubmit={submit}>
      {!compact && <h1>窓カレンダーに参加</h1>}
      <p className="muted">受け取った ID を入力してください。</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || code.trim() === ''}>
        {busy ? '確認中…' : '参加する'}
      </button>
    </form>
  );
}
