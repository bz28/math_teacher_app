import { useEffect, useState } from "react";
import { api } from "./api";
import type { SubmissionCase } from "./caseFile";

/** The submission's case file. `loaded` turns true on failure too: the
 *  rest of the trace renders without it. */
export function useSubmissionCase(submissionId: string | undefined) {
  const [data, setData] = useState<SubmissionCase | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setLoaded(false);
    api
      .submissionCase(submissionId)
      .then((d) => { if (!cancelled) { setData(d); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [submissionId]);
  return { data, loaded };
}
