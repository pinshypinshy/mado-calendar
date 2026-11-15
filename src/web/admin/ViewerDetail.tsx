// 閲覧者1人の設定：ID・招待 URL、期間制限、週の開始曜日、設定のコピー、表示ルール、プレビュー（要件 3.3〜3.8）。

import { useCallback, useMemo, useState } from 'react';
import type { AdminViewerDetail, AdminViewerLabel, DisplayRule, Level, PeriodLimit, WeekStart } from '../../shared/api';
import { LEVEL_LABELS, LEVELS } from '../../shared/api';
import type { AdminApi } from '../api/clients';
import { CalendarScreen } from '../calendar/CalendarScreen';
import { errorMessage } from '../ui/errors';
import { formatDateTime } from './format';
import { groupLabels, labelTitle } from './labels';
import { useLoad } from './useLoad';

export function ViewerDetail({ api, viewerId, onBack }: { api: AdminApi; viewerId: string; onBack: () => void }) {
  const { data, error, setData, setError } = useLoad(
    useCallback(async () => {
      const [viewer, rules, labels, calendars, viewers] = await Promise.all([
        api.viewer(viewerId),
        api.rules(viewerId),
        api.viewerLabels(viewerId),
        api.calendars(),
        api.viewers(),
      ]);
      return { viewer, rules, labels, calendars, viewers };
    }, [api, viewerId]),
  );
  // 設定を変えたらプレビューを作り直す
  const [previewVersion, setPreviewVersion] = useState(0);
  const preview = useMemo(() => api.preview(viewerId), [api, viewerId, previewVersion]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;
  const { viewer } = data;

  const run = async (fn: () => Promise<Partial<typeof data> | void>) => {
    try {
      const patch = await fn();
      if (patch) setData((prev) => (prev ? { ...prev, ...patch } : prev));
      setError(null);
      setPreviewVersion((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const updateViewer = (patch: Parameters<AdminApi['updateViewer']>[1]) =>
    run(async () => ({ viewer: await api.updateViewer(viewer.id, patch) }));

  return (
    <section>
      <button type="button" onClick={onBack}>
        ‹ 一覧に戻る
      </button>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>
          <EditableName value={viewer.displayName} onSave={(displayName) => updateViewer({ displayName })} />
          {viewer.status === 'disabled' && <span className="badge">無効</span>}
        </h2>
        <p className="muted small">
          最終閲覧：{viewer.lastSeenAt === null ? 'まだ見ていません' : formatDateTime(viewer.lastSeenAt)}
        </p>
        <CopyField label="閲覧者 ID" value={viewer.code} />
        <CopyField label="招待 URL" value={viewer.inviteUrl} />
        <div className="button-row">
          <button
            type="button"
            disabled={viewer.status === 'disabled'}
            onClick={() =>
              confirm(`${viewer.displayName} の ID を無効化しますか？参加済みの端末もすべて表示できなくなります。`) &&
              void run(async () => ({ viewer: await api.disableViewer(viewer.id) }))
            }
          >
            無効化
          </button>
          <button
            type="button"
            onClick={() =>
              confirm('ID を再発行しますか？古い ID と、参加済みの端末はすべて使えなくなります。') &&
              void run(async () => ({ viewer: await api.regenerateViewer(viewer.id) }))
            }
          >
            再発行
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!confirm(`${viewer.displayName} を削除しますか？設定もすべて消えます。`)) return;
              try {
                await api.deleteViewer(viewer.id);
                onBack();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            削除
          </button>
        </div>
      </div>

      <div className="card">
        <h3>週の開始曜日の初期値</h3>
        <select
          value={viewer.defaultWeekStart}
          onChange={(e) => void updateViewer({ defaultWeekStart: Number(e.target.value) as WeekStart })}
        >
          <option value={0}>日曜</option>
          <option value={1}>月曜</option>
        </select>
        <p className="muted small">閲覧者が自分の画面で切り替えた場合は、そちらが優先されます。</p>
      </div>

      <PeriodEditor key={JSON.stringify(viewer.period)} value={viewer.period} onSave={(period) => updateViewer({ period })} />

      <CopySettings
        viewers={data.viewers.filter((v) => v.id !== viewer.id)}
        onCopy={(sourceId) =>
          run(async () => {
            const copied = await api.copySettings(viewer.id, sourceId);
            const [rules, labels] = await Promise.all([api.rules(viewer.id), api.viewerLabels(viewer.id)]);
            return { viewer: copied, rules, labels };
          })
        }
      />

      <RulesEditor
        labels={data.labels}
        calendars={data.calendars}
        rules={data.rules}
        onChange={(calendarId, labelKey, level) =>
          run(async () => ({ rules: await api.setRule(viewer.id, calendarId, labelKey, level) }))
        }
        onRename={(calendarId, labelKey, displayName) =>
          run(async () => ({ labels: await api.renameViewerLabel(viewer.id, calendarId, labelKey, displayName) }))
        }
      />

      <div className="card">
        <h3>プレビュー（{viewer.displayName} に見えている画面）</h3>
        <div className="preview">
          <CalendarScreen key={previewVersion} feed={preview} />
        </div>
      </div>
    </section>
  );
}

function EditableName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <input
      className="name-input"
      defaultValue={value}
      key={value}
      onBlur={(e) => e.target.value.trim() !== value && e.target.value.trim() !== '' && onSave(e.target.value.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="表示名"
    />
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <span className="muted small">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  );
}

function PeriodEditor({ value, onSave }: { value: PeriodLimit; onSave: (p: PeriodLimit) => void }) {
  const [draft, setDraft] = useState(value);
  const months = (v: number | null) => (v === null ? '' : String(v));
  const parse = (s: string) => (s.trim() === '' ? null : Number(s));
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  return (
    <div className="card">
      <h3>期間制限</h3>
      <label className="check">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        期間を制限する
      </label>
      {draft.enabled && (
        <div className="period">
          <label>
            過去
            <input
              type="number"
              min={0}
              value={months(draft.pastMonths)}
              placeholder="制限なし"
              onChange={(e) => setDraft({ ...draft, pastMonths: parse(e.target.value) })}
            />
            か月前まで
          </label>
          <label>
            未来
            <input
              type="number"
              min={0}
              value={months(draft.futureMonths)}
              placeholder="制限なし"
              onChange={(e) => setDraft({ ...draft, futureMonths: parse(e.target.value) })}
            />
            か月先まで
          </label>
          <p className="muted small">空欄は制限なし。0 は今日まで。</p>
        </div>
      )}
      <button type="button" disabled={!dirty} onClick={() => onSave(draft)}>
        保存
      </button>
    </div>
  );
}

function CopySettings({
  viewers,
  onCopy,
}: {
  viewers: { id: string; displayName: string }[];
  onCopy: (sourceId: string) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  if (viewers.length === 0) return null;
  return (
    <div className="card">
      <h3>設定のコピー</h3>
      <p className="muted small">表示ルール・個別設定・期間制限・週の開始曜日の初期値を、ほかの閲覧者からコピーします（今の設定は上書きされます）。</p>
      <div className="inline-form">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">コピー元を選ぶ</option>
          {viewers.map((v) => (
            <option key={v.id} value={v.id}>
              {v.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={source === ''}
          onClick={() => confirm('今の設定を上書きしてコピーしますか？') && void onCopy(source).then(() => setSource(''))}
        >
          コピー
        </button>
      </div>
    </div>
  );
}

function RulesEditor({
  labels,
  calendars,
  rules,
  onChange,
  onRename,
}: {
  labels: AdminViewerLabel[];
  calendars: Parameters<typeof groupLabels>[1];
  rules: DisplayRule[];
  onChange: (calendarId: string, labelKey: string, level: Level) => void;
  onRename: (calendarId: string, labelKey: string, displayName: string | null) => void;
}) {
  const ruleMap = new Map(rules.map((r) => [`${r.calendarId}\u0000${r.labelKey}`, r.level]));
  const levelOf = (l: AdminViewerLabel): Level => ruleMap.get(`${l.calendarId}\u0000${l.labelKey}`) ?? 'hidden';
  const rename = (l: AdminViewerLabel, value: string) => {
    const next = value.trim() === '' ? null : value.trim();
    if (next !== l.viewerDisplayName) onRename(l.calendarId, l.labelKey, next);
  };
  const row = (l: AdminViewerLabel) => (
    <div key={l.labelKey} className="rule-row">
      <div className="rule-row-head">
        <span className="swatch" style={{ background: l.color }} />
        <span className="row-label">
          {labelTitle(l)}
          <span className="muted small"> → {l.viewerCategoryName}</span>
        </span>
      </div>
      <div className="rule-row-controls">
        <input
          // 設定のコピーなどで上書き名が変わったら、入力欄を作り直す
          key={l.viewerDisplayName ?? ''}
          defaultValue={l.viewerDisplayName ?? ''}
          placeholder={`カテゴリ名（空欄なら「${l.categoryName}」）`}
          aria-label={`${labelTitle(l)} のカテゴリ名（この閲覧者だけ）`}
          onBlur={(e) => rename(l, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <select value={levelOf(l)} onChange={(e) => onChange(l.calendarId, l.labelKey, e.target.value as Level)}>
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {LEVEL_LABELS[lv]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
  return (
    <div className="card">
      <h3>表示ルール（カレンダー × ラベル）</h3>
      <p className="muted small">
        設定していない組み合わせは「非表示」です。カテゴリ名を入れると、この閲覧者にだけその名前で見せます（空欄なら「設定 → カテゴリ名」の名前を使います）。
      </p>
      {groupLabels(labels, calendars).map((g) => {
        const rows = [...g.labels, ...g.none];
        // 閉じたままでも、どれくらい見せているかが分かるように、表示レベルごとの件数を見出しに出す
        const counts = LEVELS.map((lv) => [lv, rows.filter((l) => levelOf(l) === lv).length] as const).filter(
          ([, n]) => n > 0,
        );
        return (
          // 開閉は <details> に任せる。key が変わらないので、ルールを変えて再描画しても開閉はそのまま残る
          <details key={g.calendar.id} className="rule-group">
            <summary>
              <span className="rule-group-name">{g.calendar.name}</span>
              <span className="levels">
                {counts.map(([lv, n]) => (
                  <span key={lv} className={`level level-${lv}`}>
                    {LEVEL_LABELS[lv]} {n}
                  </span>
                ))}
              </span>
            </summary>
            {rows.map(row)}
          </details>
        );
      })}
    </div>
  );
}
