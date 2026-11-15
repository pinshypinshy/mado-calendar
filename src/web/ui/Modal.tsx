import { type ReactNode, useEffect } from 'react';

/**
 * sheet：狭い画面では下から出し、広い画面では中央に出す（詳細を見せるとき）
 * alert：画面の幅によらず、iPhone のアラートのように中央に小さく出す（短い入力や確認を求めるとき）
 */
export type ModalPlacement = 'sheet' | 'alert';

export function Modal({
  title,
  onClose,
  children,
  placement = 'sheet',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  placement?: ModalPlacement;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`modal-backdrop modal-${placement}`} onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {/* alert は中身にキャンセルのボタンを置くので、× は出さない */}
          {placement === 'sheet' && (
            <button type="button" className="icon" onClick={onClose} aria-label="閉じる">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
