"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (t: { kind?: ToastKind; text: string; action?: Toast["action"] }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-4.5 w-4.5 text-success" />,
  error: <XCircle className="h-4.5 w-4.5 text-danger" />,
  warning: <AlertTriangle className="h-4.5 w-4.5 text-warning" />,
  info: <Info className="h-4.5 w-4.5 text-info" />,
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border border-border bg-surface-raised p-3.5 shadow-xl shadow-black/10">
      <span className="mt-px shrink-0">{ICONS[toast.kind]}</span>
      <p className="flex-1 text-sm text-foreground">{toast.text}</p>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand-subtle"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-faint transition hover:text-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ kind = "success", text, action }) => {
      const id = nextId++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, text, action }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed right-[max(1.25rem,env(safe-area-inset-right))] bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[60] flex w-[calc(100vw-2.5rem)] max-w-sm flex-col gap-2">
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
