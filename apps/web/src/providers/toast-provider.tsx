'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button, CheckCircle2, Info, ShieldAlert, X, XCircle } from '@queueforge/ui';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  readonly notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastIcon({ tone }: { readonly tone: ToastTone }): React.JSX.Element {
  if (tone === 'success') return <CheckCircle2 size={18} />;
  if (tone === 'warning') return <ShieldAlert size={18} />;
  if (tone === 'error') return <XCircle size={18} />;
  return <Info size={18} />;
}

export function ToastProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info'): void => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, message, tone }].slice(-3));
      window.setTimeout(() => dismiss(id), 5_000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="qf-toast-region" aria-atomic="false" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`qf-toast qf-toast--${toast.tone}`} key={toast.id} role="status">
            <span aria-hidden="true">
              <ToastIcon tone={toast.tone} />
            </span>
            <span>{toast.message}</span>
            <Button
              aria-label="Dismiss notification"
              icon={<X size={16} />}
              onClick={() => dismiss(toast.id)}
              tone="quiet"
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) throw new Error('useToast must be used inside ToastProvider.');
  return value;
}
