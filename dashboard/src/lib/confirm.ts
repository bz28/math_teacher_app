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
  /**
   * When set, the confirm button stays disabled until the operator
   * types this exact string. Reserve it for actions whose damage
   * reaches past the thing being acted on — deleting a teacher takes
   * other students' grades with it.
   *
   * The point is not ceremony, it's defeating muscle memory. Most
   * deletions in this console are empty accounts, so an operator
   * dismisses the ordinary dialog dozens of times; a plain confirm
   * stops working exactly when it finally matters. Typing a name is
   * the one gesture that can't be performed by reflex. Pass it ONLY
   * when the impact is non-zero, or it trains the same reflex it
   * exists to break.
   */
  requireTypedConfirmation?: string;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
