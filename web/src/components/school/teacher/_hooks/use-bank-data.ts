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
 * Behavior intentionally identical to the previous inline reload:
 * - statusFilter is forwarded to the backend list endpoint
 * - unitFilter "uncategorized" is filtered client-side because the
 *   backend doesn't have an uncategorized parameter
 * - re-runs whenever courseId / statusFilter / unitFilter change
 */
export function useBankData(
  courseId: string,
  statusFilter: "pending" | "approved" | "rejected",
  unitFilter: string,
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
      const filters: { status?: string; unit_id?: string } = { status: statusFilter };
      // Backend doesn't support uncategorized filter — handled client-side below.
      if (unitFilter !== "all" && unitFilter !== "uncategorized") {
        filters.unit_id = unitFilter;
      }
      const [bankRes, unitsRes] = await Promise.all([
        teacher.bank(courseId, filters),
        teacher.units(courseId),
      ]);
      const filtered = unitFilter === "uncategorized"
        ? bankRes.items.filter((i) => i.unit_id === null)
        : bankRes.items;
      setItems(filtered);
      setUnits(unitsRes.units);
      setCounts(bankRes.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bank");
    } finally {
      setLoading(false);
    }
  }, [courseId, statusFilter, unitFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, units, counts, loading, error, reload, setError };
}
