"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon } from "@/components/ui/icons";

/* ── Types ── */
type ToastVariant = "success" | "error" | "warning" | "info";

/** One button on the toast (e.g. Undo). Clicking it runs `onAction`
 *  and dismisses the toast. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastOptions {
  action?: ToastAction;
  /** How long it stays up, unhovered. Defaults to 4 s. */
  durationMs?: number;
}

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastAPI {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
}

const DEFAULT_DURATION_MS = 4000;

/* ── Context ── */
const ToastContext = createContext<ToastAPI | null>(null);

let nextId = 0;

/* ── Icons ── */
const icons: Record<ToastVariant, ReactNode> = {
  success: <CheckIcon className="h-5 w-5" />,
  error: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

const variantStyles: Record<ToastVariant, string> = {
  success: "border-success/30 bg-success-light text-success",
  error: "border-error/30 bg-error-light text-error",
  warning: "border-warning-dark/30 bg-warning-bg text-warning-dark",
  info: "border-primary/30 bg-primary-bg text-primary",
};

/* ── Provider ── */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const durations = useRef<Map<number, number>>(new Map());

  const schedule = useCallback((id: number) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        durations.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durations.current.get(id) ?? DEFAULT_DURATION_MS),
    );
  }, []);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    durations.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, opts?: ToastOptions) => {
      const id = ++nextId;
      if (opts?.durationMs) durations.current.set(id, opts.durationMs);
      setToasts((prev) => [...prev, { id, message, variant, action: opts?.action }]);
      schedule(id);
    },
    [schedule],
  );

  // Pause auto-dismiss while the user hovers/focuses a toast (reading); resume
  // on leave so a long error can't vanish mid-read. PER-TOAST so activity on one
  // toast never re-arms or extends another (and a hovered toast stays held).
  const pauseOne = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  // Clear all pending timers on unmount (hygiene; the root provider rarely unmounts).
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api: ToastAPI = {
    success: (m, o) => push("success", m, o),
    error: (m, o) => push("error", m, o),
    warning: (m, o) => push("warning", m, o),
    info: (m, o) => push("info", m, o),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Toast container — fixed top-right. Pointer-events-none so it never
          blocks the page; the toasts themselves capture hover/focus. */}
      <div
        role="region"
        aria-label="Notifications"
        // Excluded from the tour's inert sweep (tour-overlay.tsx) so a toast
        // raised mid-tour is still announced + dismissable.
        data-toast-root
        className="pointer-events-none fixed right-0 top-0 z-50 flex flex-col items-end gap-2 p-4"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role={toast.variant === "error" ? "alert" : "status"}
              aria-atomic="true"
              onMouseEnter={() => pauseOne(toast.id)}
              onMouseLeave={() => schedule(toast.id)}
              onFocus={() => pauseOne(toast.id)}
              onBlur={() => schedule(toast.id)}
              layout
              initial={{ opacity: 0, x: 80, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className={`pointer-events-auto flex max-w-sm items-center gap-3 rounded-[--radius-md] border px-4 py-3 shadow-md ${variantStyles[toast.variant]}`}
            >
              <span className="flex-shrink-0">{icons[toast.variant]}</span>
              <p className="text-sm font-medium">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(toast.id);
                    toast.action?.onAction();
                  }}
                  className="ml-1 flex-shrink-0 rounded-[--radius-sm] px-1.5 py-0.5 text-sm font-bold underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                >
                  {toast.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="ml-2 flex-shrink-0 opacity-60 transition-opacity hover:opacity-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/* ── Hook ── */
export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
