// カテゴリ名の上書き（要件 3.4）。

import { useCallback } from 'react';
import type { AdminLabel } from '../../shared/api';
import type { AdminApi } from '../api/clients';
import { errorMessage } from '../ui/errors';
import { groupLabels, labelTitle } from './labels';
import { useLoad } from './useLoad';

export function LabelsTab({ api }: { api: AdminApi }) {
  const { data, error, setData, setError } = useLoad(
    useCallback(async () => ({ labels: await api.labels(), calendars: await api.calendars() }), [api]),
  );

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const save = async (l: AdminLabel, value: string) => {
    const next = value.trim() === '' ? null : value.trim();
    if (next === l.displayName) return;
    try {
      setData({ ...data, labels: await api.renameLabel(l.calendarId, l.labelKey, next) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section>
      <h2>カテゴリ名</h2>
      <p className="muted small">
        閲覧者に見せるカテゴリ名を上書きできます。空欄にすると、ラベルの名前（空欄ならカレンダーの名前）を使います。
      </p>
      {groupLabels(data.labels, data.calendars).map((g) => (
        <div key={g.calendar.id} className="card">
          <h3>{g.calendar.name}</h3>
          {[...g.labels, ...g.none].map((l) => (
            <LabelRow key={l.labelKey} label={l} onSave={save} />
          ))}
        </div>
      ))}
    </section>
  );
}

function LabelRow({ label, onSave }: { label: AdminLabel; onSave: (l: AdminLabel, v: string) => Promise<void> }) {
  return (
    <div className="row">
      <span className="swatch" style={{ background: label.color }} />
      <span className="row-label">{labelTitle(label)}</span>
      <input
        defaultValue={label.displayName ?? ''}
        placeholder={label.categoryName}
        onBlur={(e) => void onSave(label, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
