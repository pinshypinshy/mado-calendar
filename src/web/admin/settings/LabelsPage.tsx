// 設定 → カテゴリ名：全員共通のカテゴリ名の上書き（要件 3.4）。

import { useCallback } from 'react';
import type { AdminLabel } from '../../../shared/api';
import type { AdminApi } from '../../api/clients';
import { errorMessage } from '../../ui/errors';
import { CalendarFold } from '../CalendarFold';
import { groupLabels, labelTitle } from '../labels';
import { useLoad } from '../useLoad';

export function LabelsPage({ api }: { api: AdminApi }) {
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
      <div className="card">
        {groupLabels(data.labels, data.calendars).map((g) => {
          const rows = [...g.labels, ...g.none];
          const renamed = rows.filter((l) => l.displayName !== null).length;
          return (
            <CalendarFold
              key={g.calendar.id}
              name={g.calendar.name}
              summary={
                <>
                  <span className="level">{rows.length} 件</span>
                  {renamed > 0 && <span className="level">上書き {renamed}</span>}
                </>
              }
            >
              {rows.map((l) => (
                <LabelRow key={l.labelKey} label={l} onSave={save} />
              ))}
            </CalendarFold>
          );
        })}
      </div>
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
