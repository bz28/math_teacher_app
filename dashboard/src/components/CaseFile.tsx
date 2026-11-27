import type { SubmissionCase } from "../lib/caseFile";
import CaseProblems from "./CaseProblems";
import CaseCheck from "./CaseCheck";

// The submission case file: one row per problem (what the reader got, the
// AI's call, the final grade, the check's outcome) and the full check
// transcript. Fetched beside the trace's own reads; a failure leaves the
// rest of the trace standing.

export default function CaseFile({
  data, targetProblem,
}: {
  data: SubmissionCase | null;
  targetProblem: number | null;
}) {
  if (!data) return null;
  return (
    <>
      <CaseProblems data={data} targetProblem={targetProblem} />
      {data.integrity && <CaseCheck data={data} />}
    </>
  );
}
