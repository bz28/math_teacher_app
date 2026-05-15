import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "../lib/confirm";

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

/**
 * Drop-in async replacement for `window.confirm()`. Mount once at
 * the app root; anywhere downstream:
 *
 *     const confirm = useConfirm();
 *     if (!(await confirm({ title: "Delete?", message: "…",
 *                            confirmLabel: "Delete" }))) return;
 *     // …proceed with the destructive action…
 *
 * Same control-flow shape as the native confirm dialog, so migration
 * is a 1-line edit per call site. The hook lives in lib/confirm.ts.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Pending | null>(null);

  // Track the live pending prompt via a ref so we can resolve it
  // synchronously *outside* the setState updater. Mutating in the
  // updater fires twice under React StrictMode in dev and would
  // resolve a fresh prompt to false the instant it lands.
  const pendingRef = useRef<Pending | null>(null);

  // Resolve the previous prompt to false before showing a new one,
  // so a programmatic double-fire (or a fast double-click that races
  // ahead of the modal mount) doesn't leak the earlier promise. The
  // single-slot UX keeps "newest prompt wins" — the older caller
  // gets a clean false instead of hanging forever.
  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise((resolve) => {
      pendingRef.current?.resolve(false);
      const next: Pending = { ...options, resolve };
      pendingRef.current = next;
      setState(next);
    });
  }, []);

  const handleCancel = () => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
    setState(null);
  };
  const handleConfirm = () => {
    pendingRef.current?.resolve(true);
    pendingRef.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmModal
          title={state.title}
          message={state.message}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          variant={state.variant}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      )}
    </ConfirmContext.Provider>
  );
}
