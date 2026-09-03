import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "katex/dist/katex.min.css";

import ErrorState from "../components/ErrorState";
import MathText from "../components/MathText";
import StatusPill, { type PillTone } from "../components/StatusPill";
import { api, type AssignmentDetailData, type AssignmentProblem } from "../lib/api";

// ────────────────────────────────────────────────────────────────────
// One assignment, as the teacher built it.
//
// The console can already tell you a teacher published something (the
// activity log) and which generated questions teachers had to fix
// (GenerationQuality). Neither shows the artifact — the problems she
// KEPT and put in front of a class. That gap is what this page closes,
// so the lifecycle line is the page's argument, not its decoration:
// twelve generated, four published is the whole story in two numbers.
//
// Read-only. Per-problem class accuracy lives in the teacher's own Class
// Item Analysis and student answers in /submissions/:id/trace; both are
// deliberately absent here rather than reimplemented.
// ────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, PillTone> = {
  published: "live",
  draft: "neutral",
  closed: "info",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  // Both slots carry the id they describe, so "is this mine?" is derived
  // rather than reset on the way in. Clearing them synchronously in the
  // effect would show the previous assignment's error against a new id
  // for one frame — and is what `react-hooks/set-state-in-effect` is
  // there to stop.
  const [loaded, setLoaded] = useState<{ id: string; data: AssignmentDetailData } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .assignmentDetail(id)
      .then((d) => !cancelled && setLoaded({ id, data: d }))
      .catch((e: Error) => !cancelled && setFailed({ id, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const data = loaded && loaded.id === id ? loaded.data : null;
  const error = failed && failed.id === id ? failed.message : null;

  if (error) {
    // A deleted assignment is the common way to land here with a live
    // link — say that plainly instead of showing a raw 404 body.
    const gone = /not found/i.test(error);
    return (
      <ErrorState
        message={
          gone
            ? "This assignment no longer exists. It was probably deleted after the link was made."
            : error
        }
        onRetry={() => {
          setFailed(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }
  if (!data) return <div className="muted" style={{ padding: 24 }}>Loading…</div>;

  const a = data;
  const meta = [
    a.type,
    a.course?.name,
    a.due_at ? `due ${fmtDate(a.due_at)}` : null,
    a.integrity_check_enabled ? "integrity on" : "integrity off",
  ].filter(Boolean);

  return (
    <div style={{ padding: "20px 24px 48px", maxWidth: 860 }}>
      {a.teacher && (
        <Link
          to={`/teachers/${a.teacher.id}`}
          style={{ fontSize: 12, color: "var(--muted)" }}
        >
          ← {a.teacher.name}
        </Link>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: 30,
            lineHeight: 1.15,
            fontWeight: 400,
          }}
        >
          {a.title}
        </h2>
        <StatusPill
          tone={STATUS_TONE[a.status] ?? "neutral"}
          label={a.status}
          pulse={false}
        />
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
        {meta.join(" · ")}
      </p>

      {a.description && (
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13.5,
            color: "var(--ink-soft)",
            maxWidth: "62ch",
          }}
        >
          {a.description}
        </p>
      )}

      <Sections sections={a.sections} />
      <Lifecycle a={a} />

      <div style={{ marginTop: 22 }}>
        {a.problems.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            No problems yet — nothing has been added to this assignment.
          </p>
        ) : (
          a.problems.map((p) => <ProblemRow key={p.position} p={p} />)
        )}
      </div>
    </div>
  );
}

/** Publish time is per section, because the same homework can go to one
 *  class on Monday and another on Tuesday. Collapsing that into a single
 *  header date would report one of them as the truth. */
function Sections({ sections }: { sections: AssignmentDetailData["sections"] }) {
  if (sections.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 20px",
        marginTop: 14,
        fontSize: 12.5,
      }}
    >
      {sections.map((s) => (
        <span key={s.id} style={{ color: "var(--ink-soft)" }}>
          {s.name}{" "}
          <span style={{ color: "var(--muted-2)" }}>
            {s.published_at ? `published ${fmtDate(s.published_at)}` : "not published"}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The page's argument. Everything is muted except the two numbers that
 *  carry it — generated vs published — because the reason to open this
 *  page is to see how much of what we produced a teacher was willing to
 *  assign. */
function Lifecycle({ a }: { a: AssignmentDetailData }) {
  const kept = a.problems.filter((p) => !p.missing).length;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: "4px 18px",
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid var(--rule)",
        fontSize: 12.5,
        color: "var(--muted)",
      }}
    >
      <span>created {fmtDate(a.created_at)}</span>

      {a.generation && (
        <span>
          generated{" "}
          <strong
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              color: "var(--ink)",
              fontWeight: 500,
            }}
          >
            {a.generation.generated_count}
          </strong>
        </span>
      )}

      <span>
        published{" "}
        <strong
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            color: "var(--ink)",
            fontWeight: 500,
          }}
        >
          {kept}
        </strong>
      </span>

      {a.first_published_at && <span>{fmtDate(a.first_published_at)}</span>}

      <span style={{ color: "var(--muted-2)" }}>
        {a.submitted_count} submitted · {a.graded_count} graded ·{" "}
        {a.released_count} released
      </span>
    </div>
  );
}

function ProblemRow({ p }: { p: AssignmentProblem }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: "14px 0",
        borderBottom: "1px solid var(--rule)",
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--muted-2)",
          minWidth: 20,
          paddingTop: 2,
        }}
      >
        {p.position}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {p.missing ? (
          // Recessed, not alarming: the slot is empty, which is a fact
          // about the bank rather than a failure of this page.
          <span style={{ fontSize: 13, color: "var(--muted-2)", fontStyle: "italic" }}>
            problem no longer in the bank
          </span>
        ) : (
          <>
            <div style={{ fontSize: 14, color: "var(--ink)", overflowWrap: "anywhere" }}>
              <MathText>{p.question ?? ""}</MathText>
            </div>
            {p.final_answer ? (
              <div
                style={{
                  marginTop: 5,
                  fontSize: 13,
                  color: "var(--muted)",
                  display: "flex",
                  gap: 6,
                  alignItems: "baseline",
                  overflowWrap: "anywhere",
                }}
              >
                {/* Two stacked expressions are ambiguous without this. */}
                <span style={{ color: "var(--muted-2)", fontSize: 11.5 }}>key</span>
                <MathText>{p.final_answer}</MathText>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Deliberately not a StatusPill: the console reserves pills for
          status, and "AI · approved" is a provenance, not a health. Two
          pill families side by side would read as one. */}
      {p.provenance && (
        <span
          style={{
            fontSize: 11.5,
            color: "var(--muted-2)",
            whiteSpace: "nowrap",
            paddingTop: 2,
          }}
        >
          {p.provenance}
        </span>
      )}
    </div>
  );
}
