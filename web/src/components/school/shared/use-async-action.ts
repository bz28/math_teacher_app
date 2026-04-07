import { useState } from "react";

/**
 * Standard async-action wrapper used across the school workspace.
 * Replaces the duplicated `wrap()` helper that was inlined into
 * SectionCard, MaterialsTab, BankItemCard, and WorkshopModal.
 *
 * Usage:
 *   const { busy, error, setError, run } = useAsyncAction();
 *   const save = () => run(async () => { await api.save(); });
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, fallback = "Action failed") => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, run };
}
