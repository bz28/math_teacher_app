import { useEffect, useState } from "react";
import { teacher, type SetPracticed } from "@/lib/api";

/** Who has practiced a published practice set, per period and per
 *  problem. Null for homework, a draft set, while loading, or if the
 *  read fails: the counts are a glance, not core to the page. */
export function useSetPracticed(
  assignmentId: string,
  type: string | undefined,
  status: string | undefined,
) {
  const [practiced, setPracticed] = useState<SetPracticed | null>(null);
  useEffect(() => {
    if (type !== "practice" || status !== "published") return;
    let cancelled = false;
    teacher
      .setPracticed(assignmentId)
      .then((res) => {
        if (!cancelled) setPracticed(res);
      })
      .catch(() => {
        // Non-fatal: the page shows no counts.
      });
    return () => {
      cancelled = true;
      setPracticed(null);
    };
  }, [assignmentId, type, status]);
  return practiced;
}
