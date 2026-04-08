"use client";

import { useCallback, useEffect, useState } from "react";
import {
  teacher,
  type BankCounts,
  type BankItem,
  type TeacherUnit,
} from "@/lib/api";

export interface UseBankDataResult {
  items: BankItem[];
  units: TeacherUnit[];
  counts: BankCounts;
  loading: boolean;
  error: string | null;
  /** Manually refetch the bank list + counts. Wrap whatever onChanged
   *  callback your modal/dialog gives you with this. */
  reload: () => Promise<void>;
  /** Push an external error string into the hook so the page can
   *  surface failures from outside the data flow (e.g. variation
   *  review fetch errors). */
  setError: (e: string | null) => void;
}

/**
 * Owns all the bank-tab data fetching state — items, units, counts,
 * loading, error, and the reload action. Splits the data concern out
 * of the QuestionBankTab god-component so render code can stay focused
 * on layout + interaction.
 *
 * Behavior:
 * - statusFilter is forwarded to the backend list endpoint
 * - all items for that status are fetched in one shot; unit-level
 *   filtering happens client-side in the rail/shell so per-unit counts
 *   are accurate and switching units doesn't trigger a refetch
 * - re-runs whenever courseId / statusFilter change
 */
export function useBankData(
  courseId: string,
  statusFilter: "pending" | "approved" | "rejected",
): UseBankDataResult {
  const [items, setItems] = useState<BankItem[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [counts, setCounts] = useState<BankCounts>({
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bankRes, unitsRes] = await Promise.all([
        teacher.bank(courseId, { status: statusFilter }),
        teacher.units(courseId),
      ]);
      setItems(bankRes.items);
      setUnits(unitsRes.units);
      setCounts(bankRes.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bank");
    } finally {
      setLoading(false);
    }
  }, [courseId, statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, units, counts, loading, error, reload, setError };
}
