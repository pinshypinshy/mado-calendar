// 閲覧者の画面（要件 4章）。

import { type FormEvent, useEffect, useState } from 'react';
import type { ViewerApi } from '../api/clients';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { errorMessage, isUnauthorized } from '../ui/errors';

export interface ViewerAppProps {
  api: ViewerApi;
  /** 招待 URL（/join#ID）で開いたときの ID */
  inviteCode: string | null;
  standalone: boolean;
  inAppBrowser: boolean;
  /** 参加したあとに URL から ID を消す */
  clearInviteFromUrl: () => void;
}

type State = { kind: 'loading' } | { kind: 'joined' } | { kind: 'join'; error: string | null } | { kind: 'error'; message: string };

export function ViewerApp({ api, inviteCode, standalone, inAppBrowser, clearInviteFromUrl }: ViewerAppProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // アプリ内ブラウザでは参加しない。「Safari で開く」で URL（ID を含む）をそのまま Safari に渡すため
      if (inviteCode && !inAppBrowser) {
        try {
          await api.join(inviteCode);
          clearInviteFromUrl();
          if (!cancelled) setState({ kind: 'joined' });
          return;
        } catch (e) {
          clearInviteFromUrl();
          if (!cancelled) setState({ kind: 'join', error: errorMessage(e) });
          return;
        }
      }
      try {
        await api.me();
        if (!cancelled) setState({ kind: 'joined' });
      } catch (e) {
        if (cancelled) return;
        setState(isUnauthorized(e) ? { kind: 'join', error: null } : { kind: 'error', message: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, inviteCode, inAppBrowser, clearInviteFromUrl, attempt]);

  return (
    <div className="viewer">
      <Guidance standalone={standalone} inAppBrowser={inAppBrowser} />
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
        <JoinForm api={api} initialError={state.error} onJoined={() => setState({ kind: 'joined' })} />
      )}
      {state.kind === 'joined' && <CalendarScreen feed={api} />}
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

function JoinForm({ api, initialError, onJoined }: { api: ViewerApi; initialError: string | null; onJoined: () => void }) {
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
    <form className="center-box join" onSubmit={submit}>
      <h1>カレンダーに参加</h1>
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
