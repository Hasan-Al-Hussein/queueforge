'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { Button } from './button.js';

export interface DialogProps {
  readonly children: ReactNode;
  readonly description?: string;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function Dialog({
  children,
  description,
  footer,
  onClose,
  open,
  title,
}: DialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={description === undefined ? undefined : `${dialogId}-description`}
      aria-labelledby={`${dialogId}-title`}
      className="qf-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <header className="qf-dialog__header">
        <div>
          <h2 id={`${dialogId}-title`}>{title}</h2>
          {description !== undefined ? <p id={`${dialogId}-description`}>{description}</p> : null}
        </div>
        <Button aria-label="Close dialog" icon={<X size={18} />} onClick={onClose} tone="quiet" />
      </header>
      <div className="qf-dialog__body">{children}</div>
      {footer !== undefined ? <footer className="qf-dialog__footer">{footer}</footer> : null}
    </dialog>
  );
}
