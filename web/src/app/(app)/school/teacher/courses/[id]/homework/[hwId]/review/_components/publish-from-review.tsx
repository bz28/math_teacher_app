"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { teacher } from "@/lib/api";
import {
  missingForPublishOf,
  publishChecks,
  publishWarning,
  type PublishWarnings,
} from "../../_lib/publish-readiness";

type Assignment = Awaited<ReturnType<typeof teacher.assignment>>;

function problemsOf(a: Assignment): { bank_item_id: string }[] {
  const c = a.content;
  if (c && typeof c === "object" && "problems" in c) {
    return ((c as { problems: { bank_item_id: string }[] }).problems ?? []);
  }
  return [];
}

type State =
  | { kind: "checking" }
  | { kind: "missing"; missing: string[] }
  | { kind: "ready" }
  | { kind: "confirming"; warnings: PublishWarnings }
  | { kind: "publishing" }
  | { kind: "gone" };

/**
 * "Publish homework" on the question review's "All caught up" screen,
 * for a draft whose every problem is now approved — so the teacher
 * doesn't have to go back to the editor for the one click left.
 *
 * Same publish path as the homework page's action bar: the same
 * requirements gate it, the same soft confirm (no due date, graph
 * checklists unchecked or still being written) shows before it, and the
 * same `publishAssignment` call does it. The confirm's fixes live on the
 * homework page, so "Back to homework" is the way to fix one.
 */
export function PublishFromReview({
  assignmentId,
  homeworkHref,
}: {
  assignmentId: string;
  homeworkHref: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);

  // Read the homework as it is now — the last approvals just added its
  // problems — and only offer Publish if it's still a draft that can be.
  useEffect(() => {
    let cancelled = false;
    teacher
      .assignment(assignmentId)
      .then((a) => {
        if (cancelled) return;
        if (a.status !== "draft") return setState({ kind: "gone" });
        const missing = missingForPublishOf(a, problemsOf(a));
        setState(missing.length > 0 ? { kind: "missing", missing } : { kind: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "gone" });
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const doPublish = async () => {
    setError(null);
    setState({ kind: "publishing" });
    try {
      await teacher.publishAssignment(assignmentId);
      router.push(homeworkHref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t publish");
      setState({ kind: "ready" });
    }
  };

  // Re-read at click time: graph checklists are written in the
  // background right after Approve, so what was missing a moment ago
  // may have landed.
  const onPublishClick = async () => {
    setError(null);
    setState({ kind: "publishing" });
    try {
      const a = await teacher.assignment(assignmentId);
      if (a.status !== "draft") return router.push(homeworkHref);
      const problems = problemsOf(a);
      const missing = missingForPublishOf(a, problems);
      if (missing.length > 0) return setState({ kind: "missing", missing });
      const checks = publishChecks(a, problems);
      if (checks.anyPublishWarning) {
        return setState({
          kind: "confirming",
          warnings: {
            noDueDate: checks.noDueDate,
            uncheckedChecklists: checks.uncheckedChecklists.length,
            missingChecklists: checks.missingChecklists.length,
            checklistsLookedAgain: false,
          },
        });
      }
      await doPublish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t publish");
      setState({ kind: "ready" });
    }
  };

  if (state.kind === "checking" || state.kind === "gone") return null;

  return (
    <div className="mt-6 border-t border-green-200 pt-5 dark:border-green-500/30">
      {state.kind === "missing" ? (
        <p className="text-sm text-text-secondary">
          To publish, this homework still needs {state.missing.join(" and ")}.{" "}
          <Link href={homeworkHref} className="font-semibold text-primary hover:underline">
            Add it on the homework page →
          </Link>
        </p>
      ) : state.kind === "confirming" ? (
        <div role="alert" className="flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-[color:var(--color-warning-dark)]">
            ⚠ {publishWarning(state.warnings)}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href={homeworkHref}
              className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-bold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
            >
              Fix on the homework page
            </Link>
            <button
              type="button"
              onClick={doPublish}
              className="rounded-[--radius-md] bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700"
            >
              Publish anyway
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-text-secondary">
            Every problem is approved. Publish it to your students?
          </p>
          <button
            type="button"
            onClick={onPublishClick}
            disabled={state.kind === "publishing"}
            className="rounded-[--radius-md] bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-60"
          >
            {state.kind === "publishing" ? "Publishing…" : "Publish homework"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-[color:var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}
