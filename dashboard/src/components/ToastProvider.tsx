import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastFn, type ToastItem } from "../lib/toast";

// How long a toast lingers before it auto-dismisses. Errors stay long
// enough to read a sentence; the operator can also dismiss early.
const AUTO_DISMISS_MS = 6000;

/**
 * Mount once at the app root. Renders a stack of themed toasts in the
 * bottom-right corner and hands `useToast()` a push function. Replaces
 * native `alert()` for mutation failures so errors land inside the
 * design system instead of a jarring OS dialog that blocks the tab.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const toast = useCallback<ToastFn>(
    (message, variant = "error") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      timersRef.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  // Clear any outstanding timers if the provider unmounts.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={stackStyle} role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const isError = toast.variant === "error";
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="toast-card"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        maxWidth: 380,
        padding: "13px 14px",
        background: "var(--surface)",
        borderLeft: `3px solid ${isError ? "var(--danger)" : "var(--ok)"}`,
        borderTop: "1px solid var(--rule)",
        borderRight: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
        borderRadius: 2,
        boxShadow: "0 10px 32px rgba(20, 19, 15, 0.16)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: isError ? "var(--danger)" : "var(--ok)",
            marginBottom: 4,
          }}
        >
          {isError ? "Something went wrong" : "Done"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.45, wordBreak: "break-word" }}>
          {toast.message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          flex: "none",
          border: "none",
          background: "transparent",
          color: "var(--muted-2)",
          cursor: "pointer",
          fontSize: 15,
          lineHeight: 1,
          padding: 2,
          marginTop: -1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

const stackStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 24,
  right: 24,
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  pointerEvents: "auto",
};
