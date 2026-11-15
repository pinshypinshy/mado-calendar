// カレンダーごとに折りたたむまとまり。表示ルール（要件 3.4）とカテゴリ名の画面で使う。

import type { ReactNode } from 'react';

/**
 * 開閉は <details> に任せる。呼び出し側で key を変えなければ、再描画しても開閉はそのまま残る。
 * 最初は閉じた状態にする。閉じたままでも中身の様子が分かるよう、summary に件数などを渡す。
 */
export function CalendarFold({ name, summary, children }: { name: string; summary: ReactNode; children: ReactNode }) {
  return (
    <details className="calendar-fold">
      <summary>
        <span className="calendar-fold-name">{name}</span>
        <span className="levels">{summary}</span>
      </summary>
      {children}
    </details>
  );
}
