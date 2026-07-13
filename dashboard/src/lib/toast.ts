import { createContext, useContext } from "react";

/**
 * Shared context for the themed toast flow. The provider lives in
 * components/ToastProvider.tsx; this module owns the context + hook so
 * the provider file can satisfy react-refresh's "components-only
 * export" rule.
 *
 * Drop-in replacement for scattered `alert((e as Error).message)`
 * calls on mutation failure — those break the warm-paper palette and
 * block the whole tab. Usage:
 *
 *     const toast = useToast();
 *     try { await api.mutate(); }
 *     catch (e) { toast((e as Error).message); }
 */

export type ToastVariant = "error" | "success";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export type ToastFn = (message: string, variant?: ToastVariant) => void;

export const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
