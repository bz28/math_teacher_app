import { createContext, useContext, type ReactNode } from "react";

/**
 * Shared context for the styled async confirm() flow. The provider
 * lives in components/ConfirmProvider.tsx; this module owns the
 * context + hook so the provider can satisfy react-refresh's
 * "components-only export" rule.
 */

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
