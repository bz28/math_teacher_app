"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { DuplicateHomeworkDialog, type DuplicateSource } from "./duplicate-homework-dialog";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; homeworks: TeacherAssignment[]; courseNames: Map<string, string> };

/**
 * Every homework the teacher can copy, across all her courses (last
 * year's included), newest first, with a search. Duplicate hands one to
 * the Duplicate dialog.
 */
export function PastHomeworkList({
  onDuplicate,
}: {
  onDuplicate: (source: DuplicateSource) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const searchId = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([teacher.allAssignments(), teacher.courses()])
      .then(([a, c]) => {
        if (cancelled) return;
        setLoad({
          state: "ready",
          homeworks: a.assignments
            .filter((h) => h.type === "homework" && h.problem_count > 0)
            .sort((x, y) => y.created_at.localeCompare(x.created_at)),
          courseNames: new Map(c.courses.map((course) => [course.id, course.name])),
        });
      })
      .catch(() => !cancelled && setLoad({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const shown = useMemo(() => {
    if (load.state !== "ready") return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return load.homeworks.filter((h) => {
      const hay = `${h.title} ${load.courseNames.get(h.course_id) ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [load, query]);

  if (load.state === "loading") {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading your homework">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-[--radius-sm] bg-bg-subtle" />
        ))}
      </div>
    );
  }
  if (load.state === "error") {
    return (
      <p className="text-sm text-text-secondary">
        Couldn’t load your homework.{" "}
        <button
          type="button"
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="font-semibold text-primary hover:underline"
        >
          Try again
        </button>
      </p>
    );
  }
  if (load.homeworks.length === 0) {
    return (
      <p className="rounded-[--radius-md] border border-dashed border-border-light px-4 py-5 text-center text-sm text-text-muted">
        No homework with problems to copy yet.
      </p>
    );
  }

  return (
    <div>
      <label htmlFor={searchId} className="sr-only">
        Search your homework
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your homework"
        className="w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
      />
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="mt-2">
          {shown.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-4 border-t border-border-light py-3 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">{h.title}</div>
                <div className="mt-0.5 truncate text-xs text-text-muted">
                  {[
                    load.courseNames.get(h.course_id),
                    h.section_names.join(", "),
                    h.status,
                    `${h.problem_count} problem${h.problem_count === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onDuplicate({
                    id: h.id,
                    title: h.title,
                    course_id: h.course_id,
                    problem_count: h.problem_count,
                  })
                }
                aria-label={`Duplicate ${h.title}`}
                className="shrink-0 rounded-[--radius-sm] border border-primary/25 bg-primary-bg/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
              >
                Duplicate
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The wizard's "Copy a past homework": the list in a dialog over the
 * wizard, then the Duplicate dialog for the one she picks.
 */
export function CopyPastHomeworkDialog({
  intoCourseId,
  onClose,
}: {
  intoCourseId: string;
  onClose: () => void;
}) {
  const [source, setSource] = useState<DuplicateSource | null>(null);
  const titleId = useId();
  if (source) {
    return (
      <DuplicateHomeworkDialog
        source={source}
        intoCourseId={intoCourseId}
        onClose={() => setSource(null)}
        layered
      />
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      labelledById={titleId}
      className="max-w-2xl"
      outerClassName="z-[60]"
      portal
    >
      <h2 id={titleId} className="font-serif text-xl leading-tight text-text-primary">
        Copy a past homework
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        From any of your courses. Its problems come approved; you pick the due date and sections.
      </p>
      <div className="mt-4 max-h-[60vh] overflow-y-auto">
        <PastHomeworkList onDuplicate={setSource} />
      </div>
    </Modal>
  );
}
