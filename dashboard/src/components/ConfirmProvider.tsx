import { useCallback, useState, type ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "../lib/confirm";

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
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  >(null);

  // Resolve the previous prompt to false before showing a new one,
  // so a programmatic double-fire (or a fast double-click that races
  // ahead of the modal mount) doesn't leak the earlier promise. The
  // single-slot UX keeps "newest prompt wins" — the older caller
  // gets a clean false instead of hanging forever.
  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise((resolve) => {
      setState((prev) => {
        prev?.resolve(false);
        return { ...options, resolve };
      });
    });
  }, []);

  const handleCancel = () => {
    state?.resolve(false);
    setState(null);
  };
  const handleConfirm = () => {
    state?.resolve(true);
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
