import { Link, useParams } from "react-router-dom";
import { useScope, INTERNAL_SCHOOL_ID } from "../lib/scope";

// Stub for the per-school Overview page. Real metric tiles (cost,
// quality, health rows, top-spenders) ship in the next PR; this
// placeholder lets us merge the scope-picker + nav refactor without
// blocking on the aggregation backend.
export default function SchoolOverviewPlaceholder() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { schools } = useScope();
  const isInternal = schoolId === INTERNAL_SCHOOL_ID;
  const school = isInternal
    ? null
    : schools.find((s) => s.id === schoolId);

  return (
    <div>
      <h1>{isInternal ? "Internal" : school?.name ?? "School"}</h1>
      <p style={{ color: "#64748b", marginTop: 8 }}>
        Per-school Overview tiles ship in the next PR — cost-by-function,
        top spenders, quality, and health rows. For now use the
        {" "}
        <Link to={`/school/${schoolId}/llm-calls`}>LLM Calls</Link>
        {" "}
        view to see this scope's calls.
      </p>
    </div>
  );
}
