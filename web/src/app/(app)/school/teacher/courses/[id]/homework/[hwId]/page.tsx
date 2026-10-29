"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";
import { formatDue, sectionTargetLabel, sectionToneClass } from "@/lib/utils";
import {
  teacher,
  enterPreviewMode,
  exitPreviewMode,
  type BankItem,
  type BankJob,
  type SubmissionsInboxRow,
  type TeacherAssignment,
  type TeacherSection,
  type TeacherRubric,
  type HomeworkPoints,
  type HomeworkGraphChecklist,
} from "@/lib/api";
import { normalizeRubric } from "@/lib/rubric";
import { evenSplit, MAX_TOTAL_POINTS, pointsRange } from "@/lib/points";
import { useAuthStore } from "@/stores/auth";
import {
  BANK_JOB_POLL_INTERVAL_MS,
  BANK_JOB_POLL_LIMIT_MS,
} from "@/lib/constants";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { UnitMultiSelect } from "@/components/school/teacher/_pieces/unit-multi-select";
import { SectionMultiSelect } from "@/components/school/teacher/_pieces/section-multi-select";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GenerateQuestionsModal } from "@/components/school/teacher/question-bank/generate-questions-modal";
import { GradingSetupCard } from "@/components/school/teacher/_pieces/grading-setup-card";
import {
  PointsInput,
  PointsTotalBar,
  type PointsChange,
} from "@/components/school/teacher/_pieces/problem-points";
import { WorkshopModal } from "@/components/school/teacher/workshop-modal";
import { GraphChecklistPanel } from "@/components/school/teacher/_pieces/graph-checklist";
import { Skeleton } from "@/components/ui/skeleton";

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  /** Pre-rendered geometry SVG; null when the problem has no figure. */
  figure_svg: string | null;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
}

const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Accept any time, no penalty" },
  { value: "penalty_per_day", label: "−10% per day after due" },
  { value: "no_credit", label: "Closed after due date" },
];

// Inline-editable fields with their own SaveState — a saving units
// field doesn't block a separate due-date edit. Description is the
// student-visible instructions block under the title; the rest live
// in the Configuration accordion + grading card below the problems.
type ConfigField =
  | "units"
  | "dueAt"
  | "latePolicy"
  | "sections"
  | "rubric"
  | "description"
  | "points";

/**
 * Full-page detail for a single homework. Handles all lifecycle
 * config (units, due date, late policy, sections, rubric) inline
 * with optimistic save, plus the problems list, publish/unpublish,
 * and Submissions drawer.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]
 *
 * Navigating away (back link, delete) returns to the course HW tab.
 * The list over there self-refreshes on mount via its useEffect, so
 * edits made here are reflected when the teacher returns.
 */
export default function HomeworkDetailPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string }>;
}) {
  const { id: courseId, hwId: assignmentId } = use(params);
  const router = useRouter();
  const { loadUser } = useAuthStore();

  const [hw, setHw] = useState<
    | (TeacherAssignment & {
        content: unknown;
        rubric: TeacherRubric | null;
        points: HomeworkPoints;
        graph_checklists: Record<string, HomeworkGraphChecklist>;
      })
    | null
  >(null);
  const [loading, setLoading] = useState(true);
  // Back link points at whichever tab the assignment came from — HW
  // for type=homework, Practice for type=practice. Falls back to HW
  // while the assignment is still loading (matches prior behavior).
  const backHref =
    `/school/teacher/courses/${courseId}?tab=${
      hw?.type === "practice" ? "practice" : "homework"
    }`;
  const goBack = () => router.push(backHref);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingProblems, setEditingProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Soft confirm on Publish, for things that are usually mistakes but
  // can be meant: no due date (in-class, untimed work), or graph
  // checklists the teacher hasn't checked. It warns; it never blocks.
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  // Set to open one problem's Grading ▾ and bring it into view ("Review
  // them" on the publish confirm); `n` makes a repeat request fire again.
  const [reveal, setReveal] = useState<{ bankItemId: string; n: number } | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAsyncAction();

  // Resume-queue state: pending bank items for this HW. Powers the
  // "N pending problems" banner + the "Resume queue ▸" CTA that
  // navigates into the full-page approval queue.
  const [pending, setPending] = useState<BankItem[]>([]);
  // Submissions inbox rows for THIS HW only — populated when the HW is
  // published so the detail page can show "X of Y submitted · Z to
  // grade →". One row per section the HW reaches; null while loading
  // or when the HW is still a draft. The strip degrades silently if
  // the request fails — it's a convenience link, not core info.
  const [inboxRows, setInboxRows] = useState<SubmissionsInboxRow[] | null>(
    null,
  );
  const [showGenerate, setShowGenerate] = useState(false);
  // Active bank jobs feeding this HW. Usually one (single "Generate
  // more" call or the homework wizard's single gen job), but
  // clone-as-practice fans out one job per source problem — the
  // hero's count is the sum across all jobs in the array.
  const [activeJobs, setActiveJobs] = useState<BankJob[]>([]);
  // Click-to-edit on an approved problem opens the workshop (single
  // mode) so the teacher can edit the question / chat with AI /
  // regenerate / make similar variations — all the affordances the
  // old Question Bank tab provided. Null = workshop closed.
  const [workshopItem, setWorkshopItem] = useState<BankItem | null>(null);
  const [workshopError, setWorkshopError] = useState<string | null>(null);

  const reviewHref = `/school/teacher/courses/${courseId}/homework/${assignmentId}/review`;

  const openWorkshopForProblem = async (bankItemId: string) => {
    setWorkshopError(null);
    try {
      // Pull the full BankItem from the per-HW pool so the workshop
      // has the chat thread, variations, etc. — the HW's content
      // snapshot only carries the visible fields.
      const res = await teacher.bank(courseId, { assignment_id: assignmentId });
      const item = res.items.find((i) => i.id === bankItemId);
      if (!item) {
        setWorkshopError("Couldn't load the problem. Try again.");
        return;
      }
      setWorkshopItem(item);
    } catch (e) {
      setWorkshopError(e instanceof Error ? e.message : "Failed to load problem");
    }
  };

  // Per-field save state for the inline-edited config block.
  const [saveStates, setSaveStates] = useState<Record<ConfigField, SaveState>>({
    units: "idle",
    dueAt: "idle",
    latePolicy: "idle",
    sections: "idle",
    rubric: "idle",
    description: "idle",
    points: "idle",
  });
  const [saveErrors, setSaveErrors] = useState<Record<ConfigField, string | null>>({
    units: null,
    dueAt: null,
    latePolicy: null,
    sections: null,
    rubric: null,
    description: null,
    points: null,
  });

  const reload = async () => {
    setLoading(true);
    try {
      const a = await teacher.assignment(assignmentId);
      setHw(a);
      setTitleDraft(a.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // A checklist changed (saved, rewritten, written in the background
  // since approving, or resized by a points or rules change): re-read
  // only the checklists, so a refetch can't undo another field's
  // optimistic edit that is still saving. Throws when the read fails.
  const refreshChecklists = useCallback(async () => {
    const fresh = await teacher.assignment(assignmentId);
    setHw((h) => (h ? { ...h, graph_checklists: fresh.graph_checklists } : h));
  }, [assignmentId]);

  // Just approved: a checklist is written in the background in a few
  // seconds. Look once more for the whole page (not once per problem)
  // before the panels offer to write one by hand.
  const [checklistsLookedAgain, setChecklistsLookedAgain] = useState(false);
  const checklistPending = Object.values(hw?.graph_checklists ?? {}).some(
    (e) => !e.checklist && e.can_write,
  );
  useEffect(() => {
    if (!checklistPending || checklistsLookedAgain) return;
    const t = setTimeout(() => {
      setChecklistsLookedAgain(true);
      refreshChecklists().catch(() => undefined);
    }, 8000);
    return () => clearTimeout(t);
  }, [checklistPending, checklistsLookedAgain, refreshChecklists]);

  // Pick up any gen job(s) the wizard kicked off for this HW. The
  // wizard stashes a JSON array of job ids in sessionStorage on
  // "Create & generate" — usually one entry, but clone-as-practice
  // fans out one job per source problem. On landing we restore them
  // all and the polling effect drives the generating hero/strip.
  // The key survives navigation away and back; we clear it once
  // every job has reached a terminal state.
  useEffect(() => {
    const key = `hw-gen-${assignmentId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    // Validate before fetching — a malformed/legacy value would
    // either throw on parse or, worse, pass an `as string[]` cast
    // and quietly iterate characters of a bare string.
    let jobIds: string[];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        !Array.isArray(parsed) ||
        !parsed.every((x) => typeof x === "string")
      ) {
        sessionStorage.removeItem(key);
        return;
      }
      jobIds = parsed;
    } catch {
      sessionStorage.removeItem(key);
      return;
    }
    if (jobIds.length === 0) return;
    Promise.all(jobIds.map((id) => teacher.bankJob(courseId, id)))
      .then((jobs) => {
        setActiveJobs(jobs);
        if (jobs.every((j) => j.status === "done" || j.status === "failed")) {
          sessionStorage.removeItem(key);
        }
      })
      .catch(() => {
        // Stale key or deleted job(s) — drop it and fall back to the
        // manual-banner UX.
        sessionStorage.removeItem(key);
      });
  }, [assignmentId, courseId]);

  // Fetch pending bank items for THIS HW specifically. The backend
  // filter on originating_assignment_id keeps the pool scoped so two
  // HWs in the same unit don't share their pending items.
  const reloadPending = async () => {
    try {
      const res = await teacher.bank(courseId, {
        status: "pending",
        assignment_id: assignmentId,
      });
      setPending(res.items);
    } catch {
      // Non-fatal — the banner just won't appear if this fails.
    }
  };

  useEffect(() => {
    reloadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // Load submission inbox rows once the HW is published so the strip
  // can show submission counts. Fetches the course-level inbox and
  // filters client-side — there are typically only a few sections per
  // course so the extra rows don't matter, and we save a backend
  // endpoint just for this view. Re-fetched whenever the HW (un)pub
  // status flips.
  useEffect(() => {
    if (hw?.status !== "published") {
      setInboxRows(null);
      return;
    }
    let cancelled = false;
    teacher
      .submissionsInbox(courseId)
      .then((res) => {
        if (cancelled) return;
        setInboxRows(
          res.rows.filter((r) => r.assignment_id === assignmentId),
        );
      })
      .catch(() => {
        // Non-fatal — strip will simply not render.
      });
    return () => {
      cancelled = true;
    };
  }, [hw?.status, courseId, assignmentId]);

  // Poll any in-flight generation jobs so the hero/strip counts climb
  // live and the pending banner pops up the moment the first item
  // lands (not just on job done). Iterates every still-running job
  // each tick — usually 1, but clone-as-practice can have many.
  // Stops polling once all reach a terminal state or the ceiling
  // trips; same pattern as the course workspace page.
  //
  // Ceiling tracking via ref because the effect re-runs every poll
  // tick (setActiveJobs always produces a new array reference, so
  // the [activeJobs] dep array re-fires). A local startedAt would
  // reset every re-run and the BANK_JOB_POLL_LIMIT_MS check would
  // never trip. The ref starts the timer on the empty→inflight
  // transition and clears on inflight→empty — partial completes
  // (some jobs done, others still running) keep the original
  // timestamp so the failsafe applies to the long-tail job.
  const pollStartRef = useRef<number | null>(null);
  useEffect(() => {
    const inflightIds = activeJobs
      .filter((j) => j.status !== "done" && j.status !== "failed")
      .map((j) => j.id);
    if (inflightIds.length === 0) {
      pollStartRef.current = null;
      return;
    }
    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }
    const startedAt = pollStartRef.current;
    // Snapshot per-job produced counts at effect setup so we can
    // detect "did anything climb" without a stale closure read.
    const lastProduced = new Map(activeJobs.map((j) => [j.id, j.produced_count]));
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > BANK_JOB_POLL_LIMIT_MS) {
        setActiveJobs((prev) =>
          prev.map((j) =>
            inflightIds.includes(j.id) ? { ...j, status: "failed" as const } : j,
          ),
        );
        return;
      }
      let anyClimbed = false;
      const updates = await Promise.all(
        inflightIds.map((id) =>
          teacher
            .bankJob(courseId, id)
            .then((u) => ({ id, updated: u as BankJob | null }))
            .catch(() => ({ id, updated: null })),
        ),
      );
      for (const { id, updated } of updates) {
        if (!updated) continue;
        const prev = lastProduced.get(id) ?? 0;
        if (updated.produced_count > prev || updated.status === "done") {
          anyClimbed = true;
        }
      }
      setActiveJobs((prev) =>
        prev.map((j) => {
          const u = updates.find((x) => x.id === j.id)?.updated;
          return u ?? j;
        }),
      );
      if (anyClimbed) await reloadPending();
    }, BANK_JOB_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs, courseId]);

  const problems: AssignmentProblem[] =
    hw?.content && typeof hw.content === "object" && "problems" in hw.content
      ? ((hw.content as { problems: AssignmentProblem[] }).problems ?? [])
      : [];

  const isPublished = hw?.status === "published";
  // Homework is graded; practice isn't, so it has no points or rubric.
  const graded = hw !== null && hw.type !== "practice";

  const saveTitle = () =>
    run(async () => {
      const t = titleDraft.trim();
      if (!t) {
        setError("Title cannot be empty");
        return;
      }
      if (t === hw?.title) {
        setEditingTitle(false);
        return;
      }
      await teacher.updateAssignment(assignmentId, { title: t });
      setEditingTitle(false);
      await reload();
    });

  const saveProblems = (newPicked: string[]) =>
    run(async () => {
      if (newPicked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.updateAssignment(assignmentId, { bank_item_ids: newPicked });
      setEditingProblems(false);
      await reload();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteAssignment(assignmentId);
      goBack();
    });

  const publish = () =>
    run(async () => {
      await teacher.publishAssignment(assignmentId);
      setConfirmingPublish(false);
      await reload();
    });

  // Click handler for the Publish button. If the HW has no due date, or
  // graph checklists the teacher hasn't checked, intercept and show a
  // soft confirm — both are usually mistakes, but publishing anyway IS
  // a valid choice. Practice has no due date and no checklists, so it
  // publishes directly.
  const noDueDate = !!hw && hw.type !== "practice" && hw.due_at === null;
  const uncheckedChecklists = problems.filter((p) => {
    const c = hw?.graph_checklists?.[p.bank_item_id]?.checklist;
    return !!c && c.asks_for_drawing && !c.checked;
  });
  // Graph problems that can have a checklist but don't yet: being
  // written in the background right after Approve, or that write failed.
  const missingChecklists = problems.filter((p) => {
    const e = hw?.graph_checklists?.[p.bank_item_id];
    return !!e && !e.checklist && e.can_write;
  });
  const publishWarnings = {
    noDueDate,
    uncheckedChecklists: uncheckedChecklists.length,
    missingChecklists: missingChecklists.length,
    checklistsLookedAgain,
  };
  const anyPublishWarning =
    noDueDate || uncheckedChecklists.length > 0 || missingChecklists.length > 0;
  // The confirm reads the warnings live; once the teacher has dealt with
  // every one (checked the last checklist from the open bar), close it
  // rather than fall through to a warning that doesn't apply.
  if (confirmingPublish && !anyPublishWarning) setConfirmingPublish(false);
  const handlePublishClick = () => {
    if (anyPublishWarning) {
      setConfirmingPublish(true);
      return;
    }
    publish();
  };

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
    });

  // Token-swap preview: hands the teacher a shadow-student session and
  // navigates to the same HW on the student app. Same-tab navigation
  // because preview tokens live in localStorage which is shared across
  // tabs (a per-tab preview would require reworking auth storage).
  //
  // loadUser() is critical — without it the auth store still says
  // role=teacher and the /school/student layout's role guard redirects
  // back to /home before the page renders. loadUser swallows its own
  // errors and resolves with user=null (auth.ts:53-62), so we can't
  // rely on a throw to detect failure — we read the post-call user
  // state and treat null as failure: restore teacher tokens so the
  // teacher isn't stranded with student auth, then throw so run()
  // surfaces the error. Independent local busy flag so the button can
  // show "Switching…" without conflating with other saves.
  // The course's sections, loaded once here rather than inside the
  // picker. The header has to name them (section_names off the server
  // goes stale the moment the picker is touched) and has to know
  // whether the course has any at all, so parent-owned is the only
  // version where the two halves of this page can't disagree.
  const [courseSections, setCourseSections] = useState<TeacherSection[] | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    teacher
      .sections(courseId)
      .then((res) => {
        if (!cancelled) setCourseSections(res.sections);
      })
      .catch(() => {
        // Non-fatal: the header falls back to the ordinary draft copy
        // and the picker renders its own error.
        if (!cancelled) setCourseSections(null);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const [previewLoading, setPreviewLoading] = useState(false);
  const onPreviewAsStudent = () =>
    run(async () => {
      if (previewLoading) return;
      setPreviewLoading(true);
      try {
        const tokens = await teacher.previewAsStudent(assignmentId);
        enterPreviewMode(tokens);
        await loadUser();
        const previewUser = useAuthStore.getState().user;
        if (!previewUser) {
          exitPreviewMode();
          throw new Error(
            "Couldn't enter preview mode. Please try again.",
          );
        }
        router.push(
          `/school/student/courses/${courseId}/homework/${assignmentId}`,
        );
      } finally {
        setPreviewLoading(false);
      }
    });

  // Inline auto-save runner. Optimistic — applies the change to the
  // local hw state immediately, fires the PATCH, and on failure
  // restores ONLY this field (via the caller-supplied applyRevert).
  //
  // Per-field revert (vs replacing the whole hw object) is important:
  // if two fields are edited concurrently and the second succeeds
  // before the first fails, a whole-hw revert would wipe out the
  // second's optimistic update. Field-scoped revert leaves the
  // unrelated success intact.
  //
  // Per-field lastCallRef gives last-write-wins for rapid-fire edits
  // to the same field (the date picker can fire many onChanges).
  const lastCallRef = useRef<Record<ConfigField, number>>({
    units: 0, dueAt: 0, latePolicy: 0, sections: 0, rubric: 0, description: 0, points: 0,
  });
  const patchField = async <K extends ConfigField>(
    field: K,
    applyOptimistic: () => void,
    applyRevert: () => void,
    request: () => Promise<void>,
  ) => {
    const callId = ++lastCallRef.current[field];
    applyOptimistic();
    setSaveStates((s) => ({ ...s, [field]: "saving" }));
    setSaveErrors((s) => ({ ...s, [field]: null }));
    try {
      await request();
      // If a newer call for this field superseded us, drop silently.
      if (lastCallRef.current[field] !== callId) return;
      setSaveStates((s) => ({ ...s, [field]: "saved" }));
    } catch (e) {
      if (lastCallRef.current[field] !== callId) return;
      applyRevert();
      setSaveStates((s) => ({ ...s, [field]: "error" }));
      setSaveErrors((s) => ({
        ...s,
        [field]: e instanceof Error ? e.message : "Save failed",
      }));
    }
  };

  const onChangeUnits = (next: string[]) => {
    if (!hw) return;
    if (next.length === 0) {
      setSaveStates((s) => ({ ...s, units: "error" }));
      setSaveErrors((s) => ({ ...s, units: "At least one unit is required" }));
      return;
    }
    const prev = hw.unit_ids;
    void patchField(
      "units",
      () => setHw((h) => (h ? { ...h, unit_ids: next } : h)),
      () => setHw((h) => (h ? { ...h, unit_ids: prev } : h)),
      () =>
        teacher.updateAssignment(assignmentId, { unit_ids: next }).then(() => undefined),
    );
  };

  const onChangeDueAt = (next: string | null) => {
    if (!hw) return;
    const prev = hw.due_at;
    void patchField(
      "dueAt",
      () => setHw((h) => (h ? { ...h, due_at: next } : h)),
      () => setHw((h) => (h ? { ...h, due_at: prev } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            next === null ? { clear_due_at: true } : { due_at: next },
          )
          .then(() => undefined),
    );
  };

  const onChangeLatePolicy = (next: string) => {
    if (!hw) return;
    const prev = hw.late_policy;
    void patchField(
      "latePolicy",
      () => setHw((h) => (h ? { ...h, late_policy: next } : h)),
      () => setHw((h) => (h ? { ...h, late_policy: prev } : h)),
      () =>
        teacher
          .updateAssignment(assignmentId, { late_policy: next })
          .then(() => undefined),
    );
  };

  const onChangeSections = (next: string[]) => {
    if (!hw) return;
    const prev = hw.section_ids;
    const prevNames = hw.section_names;
    // section_names has to move with section_ids. The header reads the
    // names and the Configuration summary reads the ids; patching only
    // one leaves them describing different selections on the same
    // screen — which is how the header ended up promising "All
    // sections" at the moment a teacher narrowed it to one.
    const nextNames = next
      .map((id) => courseSections?.find((s) => s.id === id)?.name)
      .filter((n): n is string => typeof n === "string");
    void patchField(
      "sections",
      () =>
        setHw((h) =>
          h ? { ...h, section_ids: next, section_names: nextNames } : h,
        ),
      () =>
        setHw((h) =>
          h ? { ...h, section_ids: prev, section_names: prevNames } : h,
        ),
      () => teacher.assignToSections(assignmentId, next).then(() => undefined),
    );
  };

  const onChangeDescription = (next: string) => {
    if (!hw) return;
    // Trim + collapse-to-null so all-whitespace doesn't leave a phantom
    // empty block on the student page. Backend mirrors this.
    const cleaned = next.trim();
    const stored: string | null = cleaned.length > 0 ? cleaned : null;
    if (stored === (hw.description ?? null)) return;
    const prev = hw.description;
    void patchField(
      "description",
      () => setHw((h) => (h ? { ...h, description: stored } : h)),
      () => setHw((h) => (h ? { ...h, description: prev } : h)),
      () =>
        teacher
          .updateAssignment(assignmentId, { description: stored ?? "" })
          .then(() => undefined),
    );
  };

  const onChangeRubric = (patch: Partial<TeacherRubric>) => {
    if (!hw) return;
    const prev = hw.rubric;
    const merged = normalizeRubric({ ...(prev ?? {}), ...patch });
    // No-op if nothing actually changed — prevents a save round-trip
    // when a textarea blurs with unchanged content.
    if (JSON.stringify(merged) === JSON.stringify(normalizeRubric(prev ?? {}))) return;
    // If the teacher cleared every field, null the server-side rubric
    // so it reflects "no rubric authored" rather than `{}` (which the
    // server happily persists but is semantically different).
    const empty = Object.keys(merged).length === 0;
    const next: TeacherRubric | null = empty ? null : merged;
    void patchField(
      "rubric",
      () => setHw((h) => (h ? { ...h, rubric: next } : h)),
      () => setHw((h) => (h ? { ...h, rubric: prev } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            empty ? { clear_rubric: true } : { rubric: merged },
          )
          // Skipped or restored class rules change the checklists' links.
          .then(() => refreshChecklists().catch(() => undefined)),
    );
  };

  // Points save like the other inline fields: shown at once, reverted if
  // the server says no. The server also re-adds any saved grades.
  const onChangePoints = (change: PointsChange) => {
    if (!hw) return;
    const prev = hw.points;
    const next: HomeworkPoints =
      "total_points" in change
        ? {
            total: Math.max(change.total_points, problems.length),
            custom: false,
            by_problem: Object.fromEntries(
              evenSplit(change.total_points, problems.length).map((n, i) => [
                problems[i].bank_item_id,
                n,
              ]),
            ),
          }
        : {
            total: Object.values(change.problem_points).reduce((a, b) => a + b, 0),
            custom: true,
            by_problem: change.problem_points,
          };
    void patchField(
      "points",
      () => setHw((h) => (h ? { ...h, points: next } : h)),
      () => setHw((h) => (h ? { ...h, points: prev } : h)),
      // New points resize the graph checklists.
      () =>
        teacher
          .updateAssignment(assignmentId, change)
          .then(() => refreshChecklists().catch(() => undefined)),
    );
  };

  const onChangeProblemPoints = (problemId: string, n: number) => {
    if (!hw) return;
    onChangePoints({ problem_points: { ...hw.points.by_problem, [problemId]: n } });
  };

  // Publish gating — list of missing requirements with concrete fixes.
  // Sections are NOT required: the backend fans out to every section
  // in the course when the teacher publishes with an empty list. The
  // picker is for exclusions ("Period 5 doesn't get this yet"), not
  // the happy path.
  const missingForPublish: string[] = [];
  if (hw) {
    if (problems.length === 0) missingForPublish.push("at least one problem");
    if (hw.unit_ids.length === 0) missingForPublish.push("a unit");
  }
  const canPublish = !isPublished && missingForPublish.length === 0;

  const activeGenerating = activeJobs.some(
    (j) => j.status !== "done" && j.status !== "failed",
  );
  // Aggregate counts across every job feeding this HW. Drives the
  // hero and inline strip — clone-as-practice can have N jobs, so
  // displaying any single job's count would underreport.
  const aggregateRequested = activeJobs.reduce(
    (s, j) => s + j.requested_count,
    0,
  );
  const aggregateProduced = activeJobs.reduce(
    (s, j) => s + j.produced_count,
    0,
  );

  // Failed-generation surfacing. A job that ends `status:"failed"`
  // (backend failure OR the poll-ceiling timeout above) drops out of
  // the `activeGenerating` set, so the generating strip/hero silently
  // vanish — and a zero-produced run falls through to the empty hero
  // as if nothing ever happened. Instead, once nothing is still
  // generating but a tracked job ended failed with a shortfall, show a
  // persistent banner so the teacher knows what didn't come through
  // and can re-fire generation. Cleared automatically when they do
  // (onStarted drops terminal jobs from activeJobs).
  const failedJobs = activeJobs.filter((j) => j.status === "failed");
  const stalledShortfall = failedJobs.reduce(
    (s, j) => s + Math.max(0, j.requested_count - j.produced_count),
    0,
  );
  const generationStalled =
    !activeGenerating && failedJobs.length > 0 && stalledShortfall > 0;

  return (
    <>
    {workshopItem && (
      <WorkshopModal
        item={workshopItem}
        onClose={() => setWorkshopItem(null)}
        onChanged={() => {
          // Live edits to a bank item propagate to the HW's rendered
          // content because the HW stores IDs and re-fetches the
          // item's text on load. Refetch the HW here so deletions
          // and status changes (unlikely but possible) are
          // reflected immediately.
          void reload();
        }}
      />
    )}
    {showGenerate && (
      <GenerateQuestionsModal
        courseId={courseId}
        assignmentId={assignmentId}
        onClose={() => setShowGenerate(false)}
        onStarted={(job) => {
          // Append rather than replace — a teacher could in
          // principle queue multiple "Generate more" calls, and we
          // already track multi-job for clone-as-practice. Drop
          // any prior terminal jobs so they don't keep inflating
          // the aggregate count after they finished.
          setActiveJobs((prev) => [
            ...prev.filter((j) => j.status !== "done" && j.status !== "failed"),
            job,
          ]);
          setShowGenerate(false);
        }}
      />
    )}
    <div className="mx-auto max-w-4xl px-4 pb-32">
      {/* Breadcrumb */}
      <div className="pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to {hw?.type === "practice" ? "practice" : "homework"}
        </Link>
      </div>

      {/* Hero header row: status + title. Publish lives in the sticky
          action bar at the viewport bottom so it stays reachable even
          on long HWs with many problems below. */}
      <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          {hw && (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  isPublished
                    ? "bg-green-600 text-white dark:bg-green-500"
                    : "border border-gray-300 text-gray-700 dark:border-gray-500/40 dark:text-gray-300"
                }`}
              >
                {hw.status}
              </span>
              {hw.type === "practice" && (
                <span className="inline-block rounded-[--radius-pill] bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  Practice
                </span>
              )}
            </div>
          )}
          <div className="mt-2">
            {editingTitle ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTitle();
                }}
              >
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  autoFocus
                  maxLength={300}
                  className="flex-1 rounded-[--radius-md] border border-primary bg-surface px-3 py-2 text-xl font-extrabold text-text-primary focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTitle(false);
                    setTitleDraft(hw?.title ?? "");
                  }}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                disabled={loading || isPublished}
                title={isPublished ? "Unpublish to edit" : "Click to edit"}
                className="cursor-text text-left text-3xl font-extrabold tracking-tight text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
              >
                {hw?.title ?? "Loading…"}
              </button>
            )}
          </div>
        </div>

      </header>

      {/* Read-only metadata strip — surfaces due / sections / problem
          count without making the teacher expand the Configuration
          accordion below. Editing still happens there; this is the
          scan line. Practice has no due-date concept, so it's omitted
          for that type. */}
      {hw && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
          {hw.type !== "practice" && (
            <>
              <span className={hw.due_at ? "" : "italic"}>
                {hw.due_at ? formatDue(hw.due_at) : "No due date"}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          {(() => {
            // Same helper and the same inputs as the Configuration
            // summary further down, so the two can't disagree on the
            // same page.
            const s = sectionTargetLabel({
              selectedNames: hw.section_names,
              status: hw.status,
              courseSectionCount: courseSections?.length ?? null,
            });
            return <span className={sectionToneClass(s.tone)}>{s.label}</span>;
          })()}
          <span aria-hidden>·</span>
          <span>
            {problems.length} {problems.length === 1 ? "problem" : "problems"}
          </span>
        </div>
      )}

      {/* Instructions students will see (e.g. "Show all work, no
          calculators"). Editable inline; lives just below the title so
          teachers see it as a first-class part of the HW, not buried in
          a settings page. Editable while published — instructions
          don't change which problems students see. Practice has no
          student-visible page yet, so we hide the field there. */}
      {!editingProblems && hw && hw.type !== "practice" && (
        <InstructionsBlock
          value={hw.description}
          saveState={saveStates.description}
          saveError={saveErrors.description}
          onChange={onChangeDescription}
        />
      )}


      {/* Loading / editing-problems states short-circuit the page */}
      {(loading || !hw) ? (
        <div
          className="mt-6 space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-8 shadow-sm"
          aria-busy="true"
          aria-live="polite"
        >
          {/* Mirror the problem-list silhouette so the editor settles in
              place rather than blanking to "Loading…". */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 border-b border-border-light pb-4 last:border-0 last:pb-0"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : editingProblems ? (
        <div className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
          <RemoveProblemsView
            problems={problems}
            onCancel={() => setEditingProblems(false)}
            onSave={saveProblems}
            busy={busy}
          />
        </div>
      ) : (
        <>
          {isPublished && (
            <div className="mt-4 rounded-[--radius-md] border border-primary/20 bg-primary-bg/30 p-3 text-xs text-text-secondary">
              Published — students can see this. Points, grading rules
              and instructions stay editable; unpublish to change the
              problem list, title, due date, or sections.
            </div>
          )}

          {/* Submission summary — only shown for published HWs. Tells
              the teacher at a glance how many students have submitted
              and how many need grading, with a one-click jump to the
              grading queue. Multi-section HWs expand into an inline
              section picker rather than auto-pick a section. */}
          {isPublished && inboxRows && inboxRows.length > 0 && (
            <SubmissionStrip
              courseId={courseId}
              assignmentId={assignmentId}
              rows={inboxRows}
            />
          )}

          {/* Generation-stalled banner — persistent surfacing of a
              failed gen job so a zero-produced (or short) run doesn't
              vanish into the empty hero. Sits above the pending banner
              so its "safe in Pending review" note points right at it. */}
          {generationStalled && (
            <GenerationStalledBanner
              shortfall={stalledShortfall}
              savedCount={pending.length}
              disabled={isPublished}
              onRetry={() => setShowGenerate(true)}
            />
          )}

          {/* Pending review is the primary CTA when generation produced
              anything. Solid amber-tinted card (no gradient — washes
              out the text) with high-contrast copy. */}
          {pending.length > 0 && (
            <Link
              href={reviewHref}
              className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-5 py-4 shadow-sm transition-all hover:border-[color:var(--color-warning)]/50 hover:bg-[color:var(--color-warning-bg)] hover:shadow  dark:bg-[color:var(--color-warning)]/10 dark:hover:bg-[color:var(--color-warning)]/20"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">🔔</span>
                <div>
                  <p className="text-sm font-bold text-text-primary">
                    {pending.length} {pending.length === 1 ? "problem" : "problems"} {pending.length === 1 ? "needs" : "need"} your review
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Approve to add them to this homework, reject to drop them.
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-[--radius-md] bg-[color:var(--color-warning-dark)] px-4 py-2 text-xs font-bold text-white">
                Review ▸
              </span>
            </Link>
          )}

          {/* Problems & grading — the hero of the page. Holds every
              grading decision for a homework: what each problem is
              worth, its answer key, and the rules for every problem.
              Practice is ungraded, so it keeps a plain problem list. */}
          <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light pb-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                {graded ? "Problems & grading" : "Problems"} · {problems.length}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGenerate(true)}
                  disabled={isPublished}
                  title={isPublished ? "Unpublish to generate more" : "Generate with AI"}
                  className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-bg/60 disabled:opacity-50"
                >
                  ✨ Generate more
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Drop any in-flight publish soft-confirm so the
                    // teacher doesn't return from removal mode to a
                    // stale "Publish anyway?" bar from before.
                    setConfirmingPublish(false);
                    setEditingProblems(true);
                  }}
                  disabled={isPublished || problems.length === 0}
                  title={
                    isPublished
                      ? "Unpublish to remove problems"
                      : problems.length === 0
                        ? "Nothing to remove"
                        : "Remove problems from this homework in bulk"
                  }
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-[color:var(--color-error-border)] hover:text-[color:var(--color-error)] disabled:opacity-50 disabled:hover:border-border-light disabled:hover:text-text-secondary"
                >
                  Remove problems
                </button>
              </div>
            </div>

            {/* State-driven body */}
            {activeGenerating && problems.length === 0 ? (
              <ProblemsGeneratingHero
                requestedCount={aggregateRequested}
                producedCount={aggregateProduced}
              />
            ) : problems.length === 0 ? (
              <ProblemsEmptyHero
                disabled={isPublished}
                onGenerate={() => setShowGenerate(true)}
              />
            ) : (
              <>
                {/* Inline generating strip when we already have
                    problems but the teacher kicked off more.
                    role=status announces the live count to screen
                    readers, mirroring the empty-state hero. */}
                {activeGenerating && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-4 flex items-center gap-3 rounded-[--radius-md] border border-primary/30 bg-primary-bg/30 px-3 py-2 text-xs text-text-primary dark:border-primary/40 dark:bg-primary/10"
                  >
                    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    <span>
                      <span className="font-semibold">
                        {aggregateProduced > 0
                          ? `Generating ${aggregateRequested} more… · ${aggregateProduced} of ${aggregateRequested} ready`
                          : `Generating ${aggregateRequested} more…`}
                      </span>{" "}
                      <span className="text-text-secondary">new ones land in the review queue when ready.</span>
                    </span>
                  </div>
                )}
                {graded && (
                  <PointsTotalBar
                    points={hw.points}
                    problemCount={problems.length}
                    isPublished={isPublished}
                    saveState={saveStates.points}
                    saveError={saveErrors.points}
                    onChange={onChangePoints}
                  />
                )}
                <ul className="mt-3 space-y-2">
                  {problems.map((p) => (
                    <ProblemRow
                      key={`${p.bank_item_id}-${p.position}`}
                      problem={p}
                      points={graded ? (hw.points.by_problem[p.bank_item_id] ?? null) : null}
                      onPointsChange={(n) => onChangeProblemPoints(p.bank_item_id, n)}
                      validatePoints={(n) => {
                        if (n < 1) return "At least 1 point.";
                        const others = hw.points.total - (hw.points.by_problem[p.bank_item_id] ?? 0);
                        return others + n > MAX_TOTAL_POINTS
                          ? `The homework would be worth more than ${MAX_TOTAL_POINTS}.`
                          : null;
                      }}
                      onEdit={
                        isPublished
                          ? undefined
                          : () => void openWorkshopForProblem(p.bank_item_id)
                      }
                      checklist={hw.graph_checklists?.[p.bank_item_id]}
                      checklistLookedAgain={checklistsLookedAgain}
                      onChecklistChanged={refreshChecklists}
                      reveal={reveal?.bankItemId === p.bank_item_id ? reveal.n : undefined}
                      published={isPublished}
                    />
                  ))}
                </ul>
              </>
            )}

            {/* The rules for every problem. Hidden for practice:
                practice is ungraded, no rubric feeds the grader. */}
            {graded && (
              <GradingSetupCard
                embedded
                rubric={hw.rubric}
                saveState={saveStates.rubric}
                saveError={saveErrors.rubric}
                onChange={onChangeRubric}
                copyFromAssignmentId={assignmentId}
                courseId={courseId}
              />
            )}
          </section>

          {/* Configuration — collapsed accordion. Auto-expands on a
              fresh HW with no problems OR when a required field is
              missing, so teachers can't accidentally collapse the only
              way to fix what's blocking publish. Collapses once
              everything's set. For practice we hide the due date + late
              policy inputs (neither applies) but keep units + sections
              since they still drive visibility. */}
          <div className="mt-4">
            <CollapsibleSection
              label="Configuration"
              summary={configSummary(hw, courseSections?.length ?? null)}
              defaultOpen={problems.length === 0 || hw.unit_ids.length === 0}
            >
              <ConfigBlock
                hw={hw}
                courseId={courseId}
                courseSections={courseSections}
                disabled={isPublished}
                saveStates={saveStates}
                saveErrors={saveErrors}
                dueDateInputRef={dueDateInputRef}
                onChangeUnits={onChangeUnits}
                onChangeDueAt={onChangeDueAt}
                onChangeLatePolicy={onChangeLatePolicy}
                onChangeSections={onChangeSections}
              />
            </CollapsibleSection>
          </div>

          {error && <p className="mt-4 text-xs text-[color:var(--color-error)]">{error}</p>}
          {workshopError && (
            <p className="mt-4 text-xs text-[color:var(--color-error)]">{workshopError}</p>
          )}

          {/* Delete — subtle affordance at the bottom right. Red
              confirm inline to catch accidental clicks. */}
          <div className="mt-8 flex justify-end">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[color:var(--color-error)] ">
                  Delete this homework?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-[--radius-md] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85 disabled:opacity-50"
                >
                  Yes, delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={isPublished}
                title={isPublished ? "Unpublish before deleting" : "Delete this homework"}
                className="text-xs font-semibold text-text-muted hover:text-[color:var(--color-error)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🗑 Delete homework
              </button>
            )}
          </div>
        </>
      )}
    </div>
    {/* Sticky action bar — pins Publish + Preview-as-student to the
        viewport bottom so they're always reachable, no matter how far
        the teacher has scrolled. Hidden during the in-place "edit
        problems" sub-view because that mode has its own footer. */}
    {hw && !editingProblems && !loading && (
      <ActionBar
        isPublished={isPublished}
        canPublish={canPublish}
        missingForPublish={missingForPublish}
        pointsSummary={
          graded && problems.length > 0
            ? `${hw.points.total} points · ${problems.length} problem${problems.length === 1 ? "" : "s"}, ${pointsRange(Object.values(hw.points.by_problem))}`
            : null
        }
        busy={busy}
        previewLoading={previewLoading}
        onPublish={handlePublishClick}
        onUnpublish={unpublish}
        onPreviewAsStudent={onPreviewAsStudent}
        confirming={confirmingPublish && anyPublishWarning ? publishWarnings : null}
        onReviewChecklists={() => {
          setConfirmingPublish(false);
          const first = uncheckedChecklists[0] ?? missingChecklists[0];
          if (first) setReveal((r) => ({ bankItemId: first.bank_item_id, n: (r?.n ?? 0) + 1 }));
        }}
        onAddDueDate={() => {
          setConfirmingPublish(false);
          // Best-effort scroll to the due-date input if it's currently
          // mounted (i.e. the Configuration accordion is expanded).
          // When collapsed, the ref is null — the teacher needs to
          // expand Configuration manually. Documenting that here so a
          // future PR can auto-expand on this path.
          setTimeout(() => {
            dueDateInputRef.current?.focus();
            dueDateInputRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
        }}
        onConfirmPublish={publish}
      />
    )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Compact one-line summary of the HW's configuration — shows in the
// collapsed Settings accordion so teachers can see the gist without
// expanding. Keep it dense; this is a scan line, not a form.
// ────────────────────────────────────────────────────────────────────
function configSummary(
  hw: TeacherAssignment,
  courseSectionCount: number | null,
): string {
  const parts: string[] = [];
  parts.push(`${hw.unit_ids.length} unit${hw.unit_ids.length === 1 ? "" : "s"}`);
  // Practice has no deadline concept — skip the due-date part
  // entirely rather than show "No due date" on every practice card.
  if (hw.type !== "practice") {
    if (hw.due_at) {
      const d = new Date(hw.due_at);
      parts.push(
        `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      );
    } else {
      parts.push("No due date");
    }
  }
  parts.push(
    hw.section_ids.length > 0
      ? `${hw.section_ids.length} section${hw.section_ids.length === 1 ? "" : "s"}`
      : sectionTargetLabel({
          selectedNames: [],
          status: hw.status,
          courseSectionCount,
        }).label,
  );
  return parts.join(" · ");
}

// ────────────────────────────────────────────────────────────────────
// Collapsible — lightweight accordion wrapper for the Settings card.
// `defaultOpen` is captured into state at mount so it doesn't flip
// when the teacher toggles it manually.
// ────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            {label}
          </span>
          {summary && !open && (
            <span className="text-xs text-text-secondary">{summary}</span>
          )}
        </div>
        <span className="text-xs text-text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-border-light p-5">{children}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty hero — shown in the Problems section when there are no
// problems AND nothing is generating. Turns the dead-end into a clear
// next action.
// ────────────────────────────────────────────────────────────────────
function ProblemsEmptyHero({
  disabled,
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-5 rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)]/50 px-8 py-12 text-center">
      <div className="text-5xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Let&apos;s add some problems
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        Generate with AI in ~30 seconds, grounded in your uploaded materials.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark hover:shadow disabled:opacity-50"
      >
        ✨ Generate problems
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Generating hero — shown in the Problems section while a gen job is
// in flight and zero problems have landed yet. Mirrors the empty-hero
// aesthetic so an in-flight gen reads as a deliberate "we're on it"
// state, not a stalled skeleton. Live count comes from the polled job.
// ────────────────────────────────────────────────────────────────────
function ProblemsGeneratingHero({
  requestedCount,
  producedCount,
}: {
  requestedCount: number;
  producedCount: number;
}) {
  const noun = requestedCount === 1 ? "problem" : "problems";
  // role="status" announces text changes politely — drives the "X of Y
  // ready" subcopy update so screen-reader users hear progress.
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-5 rounded-[--radius-xl] border border-dashed border-primary/40 bg-primary-bg/20 px-8 py-12 text-center"
    >
      <div className="animate-pulse text-5xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Generating {requestedCount} {noun}…
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        {producedCount > 0
          ? `${producedCount} of ${requestedCount} ready — they'll land in the review queue as the AI finishes each one.`
          : "The AI is crafting them from your uploaded materials. Usually about 30 seconds."}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Generation-stalled banner — persistent surfacing of a failed gen job.
// A failed job (backend error or the poll-ceiling timeout) otherwise
// drops out of the "generating" set, so the progress strip just
// disappears and a zero-produced run falls through to the empty hero
// as if nothing happened. This banner keeps the failure visible with a
// one-click re-fire (reuses the existing Generate-more trigger — no new
// backend retry semantics) and reassures that anything the job DID
// produce is safe in the pending-review queue.
// ────────────────────────────────────────────────────────────────────
function GenerationStalledBanner({
  shortfall,
  savedCount,
  disabled,
  onRetry,
}: {
  shortfall: number;
  savedCount: number;
  disabled: boolean;
  onRetry: () => void;
}) {
  const noun = shortfall === 1 ? "problem" : "problems";
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex flex-col gap-3 rounded-[--radius-xl] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden="true">⚠️</span>
        <div>
          <p className="text-sm font-bold text-[color:var(--color-error)]">
            {`Generation stalled — ${shortfall} ${noun} didn’t come through`}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {savedCount > 0
              ? `Anything already produced is safe in Pending review below — nothing was lost. Try again to finish the set.`
              : `Nothing came through this time. Try again — anything produced lands safely in Pending review.`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        title={disabled ? "Unpublish to generate more" : "Re-run generation"}
        className="shrink-0 self-start rounded-[--radius-md] bg-[color:var(--color-error)] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 sm:self-auto"
      >
        Try again
      </button>
    </div>
  );
}

// ── Configuration block ──

function ConfigBlock({
  hw,
  courseId,
  courseSections,
  disabled,
  saveStates,
  saveErrors,
  dueDateInputRef,
  onChangeUnits,
  onChangeDueAt,
  onChangeLatePolicy,
  onChangeSections,
}: {
  hw: TeacherAssignment;
  courseId: string;
  courseSections: TeacherSection[] | null;
  disabled: boolean;
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  dueDateInputRef?: React.Ref<HTMLInputElement>;
  onChangeUnits: (next: string[]) => void;
  onChangeDueAt: (next: string | null) => void;
  onChangeLatePolicy: (next: string) => void;
  onChangeSections: (next: string[]) => void;
}) {
  return (
    <div className="space-y-5 rounded-[--radius-md] border border-border-light bg-surface/30 p-4">
      {/* Units */}
      <Field
        label="Units"
        required
        hint={
          saveStates.units === "idle" && hw.unit_ids.length === 0
            ? "Required — at least one unit"
            : undefined
        }
        saveState={saveStates.units}
        saveError={saveErrors.units}
      >
        <UnitMultiSelect
          courseId={courseId}
          selected={hw.unit_ids}
          onChange={onChangeUnits}
          disabled={disabled}
        />
      </Field>

      {/* Due date — hidden for practice: practice is ungraded and
          has no deadline concept. */}
      {hw.type !== "practice" && (
        <Field
          label="Due date"
          saveState={saveStates.dueAt}
          saveError={saveErrors.dueAt}
        >
          <DueDatePicker
            value={hw.due_at}
            onChange={onChangeDueAt}
            disabled={disabled}
            inputRef={dueDateInputRef}
          />
        </Field>
      )}

      {/* Late policy — hidden for practice: nothing can be late
          when there's no due date. */}
      {hw.type !== "practice" && (
        <Field
          label="Late policy"
          saveState={saveStates.latePolicy}
          saveError={saveErrors.latePolicy}
        >
          <div className="flex flex-wrap gap-1.5">
            {LATE_POLICY_OPTIONS.map((opt) => {
              const active = hw.late_policy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeLatePolicy(opt.value)}
                  disabled={disabled}
                  className={`rounded-[--radius-pill] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)]"
                  }`}
                >
                  {active && <span className="mr-1">✓</span>}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {/* Sections */}
      <Field
        label="Sections"
        hint={
          hw.section_ids.length > 0 || hw.status === "published"
            ? undefined
            : "Leave empty to publish to every section in this course"
        }
        saveState={saveStates.sections}
        saveError={saveErrors.sections}
      >
        <SectionMultiSelect
          courseId={courseId}
          sections={courseSections}
          selected={hw.section_ids}
          onChange={onChangeSections}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  saveState,
  saveError,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  saveState: SaveState;
  saveError: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          {label}
          {required && (
            <span className="ml-1 font-normal normal-case text-text-muted/70">· required</span>
          )}
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      {children}
      {hint && saveState === "idle" && (
        <p className="mt-1 text-[10px] text-text-muted">{hint}</p>
      )}
    </div>
  );
}

// Native datetime-local picker. The browser handles localization and
// the mobile experience. Returns null when cleared.
function DueDatePicker({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  // Snapshot "now" once at mount so the render stays pure (Date.now()
  // in render trips react-hooks/purity). The modal is short-lived
  // enough that a stale snapshot is fine — the warning is informational
  // and the only edge case is "user picks a future date that becomes
  // past while the modal stays open for hours," which we don't care
  // about.
  const [now] = useState(() => Date.now());
  // datetime-local needs YYYY-MM-DDTHH:mm — drop the timezone suffix.
  const localValue = value ? toLocalDatetimeInputValue(value) : "";
  const isPast = value !== null && new Date(value).getTime() < now;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="datetime-local"
        value={localValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onChange(null);
            return;
          }
          // Parse the local-time string back to an ISO with the
          // browser's local timezone offset baked in.
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) return;
          onChange(d.toISOString());
        }}
        disabled={disabled}
        className="rounded-[--radius-md] border border-border-light bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] font-semibold text-text-muted hover:text-text-primary"
        >
          Clear
        </button>
      )}
      {isPast && !disabled && (
        <span className="text-[10px] font-semibold text-[color:var(--color-warning-dark)]">
          ⚠ in the past
        </span>
      )}
    </div>
  );
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ── Problem row ──
//
// Fat card with the math-rendered question as the focal element.
// Read-only — clicking does nothing; editing happens via the Edit
// problems button at the top of this modal.
function ProblemRow({
  problem,
  points,
  onPointsChange,
  validatePoints,
  onEdit,
  checklist,
  checklistLookedAgain,
  onChecklistChanged,
  reveal,
  published,
}: {
  problem: AssignmentProblem;
  /** Changes when the page asks this row to open its Grading ▾ and
   *  scroll into view. */
  reveal?: number;
  published: boolean;
  /** Present for a problem that requires a drawing. */
  checklist?: HomeworkGraphChecklist;
  checklistLookedAgain: boolean;
  onChecklistChanged: () => Promise<void>;
  /** What it's worth; null for practice (ungraded: no points, no
   *  grading details). */
  points: number | null;
  onPointsChange: (n: number) => void;
  validatePoints: (n: number) => string | null;
  /** Opens the question in the Workshop editor; absent once published. */
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // A new reveal request opens the row (adjusted during render, so the
  // panel is there on the first paint), then the effect scrolls to it.
  const [seenReveal, setSeenReveal] = useState(reveal);
  if (reveal !== seenReveal) {
    setSeenReveal(reveal);
    if (reveal !== undefined) setOpen(true);
  }
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (reveal !== undefined) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [reveal]);
  const panelId = `grading-${problem.position}-${problem.bank_item_id}`;
  const unchecked =
    !!checklist?.checklist && checklist.checklist.asks_for_drawing && !checklist.checklist.checked;
  // One box, placed beside the question on wide screens and under it on
  // a phone, where the question needs the width.
  const pointsBox = (where: string) =>
    points !== null && (
      <label className={`shrink-0 items-center gap-1.5 text-xs text-text-muted ${where}`}>
        <PointsInput
          value={points}
          label={`Points for problem ${problem.position}`}
          onCommit={onPointsChange}
          validate={validatePoints}
        />
        pts
      </label>
    );
  return (
    <li ref={rowRef} className="scroll-mb-24 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
          {problem.position}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] leading-snug text-text-primary">
            <MathText text={problem.question} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {pointsBox("order-last ml-auto flex sm:hidden")}
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              {problem.difficulty}
            </span>
            {points !== null ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Grading <span aria-hidden>{open ? "▴" : "▾"}</span>
              </button>
            ) : (
              onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex min-h-8 items-center text-xs font-semibold text-primary hover:underline"
                >
                  Edit question
                </button>
              )
            )}
            {points !== null && unchecked && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-controls={open ? panelId : undefined}
                className="rounded-full border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-warning-dark)] hover:border-[color:var(--color-warning)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-warning)]"
              >
                Graph checklist · not checked
              </button>
            )}
          </div>
        </div>
        {pointsBox("hidden sm:flex")}
      </div>
      {open && points !== null && (
        <div
          id={panelId}
          className="mt-3 ml-9 space-y-2 rounded-[--radius-md] border border-border-light bg-bg-subtle/40 px-3 py-2.5 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="min-w-0">
              <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                Answer key
              </span>
              {problem.final_answer ? (
                <span className="text-text-primary">
                  <MathText text={problem.final_answer} />
                </span>
              ) : (
                <span className="text-text-muted">No final answer set.</span>
              )}
            </p>
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                Edit question ↗
              </button>
            ) : (
              <span className="shrink-0 text-xs text-text-muted">Locked while published</span>
            )}
          </div>
          {checklist ? (
            <GraphChecklistPanel
              entry={checklist}
              bankItemId={problem.bank_item_id}
              problemPoints={points}
              lookedAgain={checklistLookedAgain}
              published={published}
              onChanged={onChecklistChanged}
              onEditQuestion={onEdit}
            />
          ) : (
            <p className="text-xs text-text-secondary">
              Graded by AI using the rules below.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ── Remove problems sub-view ──
//
// Bulk-select UI for taking problems off a HW without going into each
// one individually. Uncheck the cards you want to drop, save. Editing
// the content of a single problem (question text, solution, chat with
// AI) happens by clicking the problem card itself — not here.

function RemoveProblemsView({
  problems,
  onCancel,
  onSave,
  busy,
}: {
  problems: AssignmentProblem[];
  onCancel: () => void;
  /** Called with the bank_item_ids the teacher wants to KEEP after
   *  the bulk remove. Parent's `saveProblems` writes that list as
   *  the new HW content. */
  onSave: (next: string[]) => void;
  busy: boolean;
}) {
  // Set of bank_item_ids currently marked for removal. Click × on a
  // row to add/remove from this set — nothing is committed until
  // Save. Cancel discards the marks and keeps the HW as-is.
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const kept = problems.filter((p) => !marked.has(p.bank_item_id));
  const wouldLeaveEmpty = kept.length === 0;
  const markCount = marked.size;

  const save = () => {
    if (markCount === 0) return;
    if (wouldLeaveEmpty) return;
    onSave(kept.map((p) => p.bank_item_id));
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Remove problems
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Click × on a problem to mark it for removal. Nothing is removed
            until you Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || markCount === 0 || wouldLeaveEmpty}
            title={
              wouldLeaveEmpty
                ? "Keep at least one problem — or delete the homework instead"
                : markCount === 0
                  ? "Click × on a problem to mark it for removal"
                  : `Remove ${markCount} problem${markCount === 1 ? "" : "s"}`
            }
            className="rounded-[--radius-md] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[color:var(--color-error)]/85 disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-600"
          >
            {busy
              ? "Saving…"
              : markCount === 0
                ? "Remove"
                : `Remove ${markCount}`}
          </button>
        </div>
      </div>

      {wouldLeaveEmpty && markCount > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-text-primary  dark:bg-[color:var(--color-warning)]/10">
          You&apos;ve marked every problem. Keep at least one, or{" "}
          <span className="font-semibold">delete the homework</span> instead if
          you want to start over.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {problems.map((p) => {
          const isMarked = marked.has(p.bank_item_id);
          return (
            <RemovableProblemRow
              key={`${p.bank_item_id}-${p.position}`}
              problem={p}
              marked={isMarked}
              disabled={busy}
              onToggle={() => toggle(p.bank_item_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function RemovableProblemRow({
  problem,
  marked,
  disabled,
  onToggle,
}: {
  problem: AssignmentProblem;
  marked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[--radius-md] border px-4 py-3 transition-all ${
        marked
          ? "border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)]/60 opacity-60  dark:bg-[color:var(--color-error-light)]"
          : "border-border-light bg-surface"
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
          marked
            ? "bg-gray-400 dark:bg-gray-600"
            : "bg-gradient-to-br from-primary to-primary-dark"
        }`}
      >
        {problem.position}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`line-clamp-2 text-[15px] leading-snug text-text-primary ${
            marked ? "line-through" : ""
          }`}
        >
          <MathText text={problem.question} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            {problem.difficulty}
          </span>
          {marked && (
            <span className="text-[10px] font-semibold text-[color:var(--color-error)] ">
              · marked for removal
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={marked ? "Undo remove" : "Mark for removal"}
        className={`shrink-0 rounded-full p-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
          marked
            ? "bg-surface text-primary hover:text-primary-dark"
            : "text-text-muted hover:bg-[color:var(--color-error-light)] hover:text-[color:var(--color-error)] dark:hover:bg-[color:var(--color-error-light)]"
        }`}
        title={marked ? "Undo" : "Mark for removal"}
      >
        {marked ? "Undo" : "✕"}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Submission strip — slim "X of Y submitted · Z to grade →" line that
// sits between the published-lock banner and the pending-review card.
// Single-section HWs deep-link directly to the grading queue; multi-
// section HWs expand inline into a section picker so the teacher
// chooses which queue to enter rather than us guessing.
// ────────────────────────────────────────────────────────────────────
function SubmissionStrip({
  courseId,
  assignmentId,
  rows,
}: {
  courseId: string;
  assignmentId: string;
  rows: SubmissionsInboxRow[];
}) {
  const [open, setOpen] = useState(false);

  const totalStudents = rows.reduce((s, r) => s + r.total_students, 0);
  const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);
  // "To review" = submissions whose grade isn't out yet OR has been
  // edited since publish. `to_grade` counts only graded-but-unpublished
  // (per teacher_assignments.py:985-994), so the truly-ungraded would
  // be silently dropped if we used it directly. `submitted - published`
  // captures both ungraded + to_grade in one expression; `+ dirty`
  // adds back the published-but-edited subset that needs a republish
  // click before students see the latest. Flagged is reported
  // separately as an integrity signal, not a grading-pipeline state.
  const totalToReview = rows.reduce(
    (s, r) => s + (r.submitted - r.published) + r.dirty,
    0,
  );
  const totalFlagged = rows.reduce((s, r) => s + r.flagged, 0);

  const parts: string[] =
    totalSubmitted === 0
      ? [`Waiting for first submission`]
      : [`${totalSubmitted} of ${totalStudents} submitted`];
  if (totalToReview > 0) parts.push(`${totalToReview} to review`);
  if (totalFlagged > 0) parts.push(`⚑ ${totalFlagged} flagged`);
  const summary = parts.join(" · ");

  const reviewHref = (sectionId: string) =>
    `/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${sectionId}/review`;

  // Single-section HW: one click goes straight to the grading queue.
  if (rows.length === 1) {
    return (
      <Link
        href={reviewHref(rows[0].section_id)}
        className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:bg-[color:var(--color-surface-alt-2)]"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">View submissions →</span>
      </Link>
    );
  }

  // Multi-section: expandable inline picker so the teacher picks the
  // section to grade rather than landing in a default they didn't ask
  // for. Counts live on each row so the choice is informed.
  return (
    <div className="mt-4 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">
          {open ? "Hide sections ▴" : "View submissions →"}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border-light border-t border-border-light bg-surface">
          {rows.map((r) => {
            const toReview = (r.submitted - r.published) + r.dirty;
            return (
              <Link
                key={r.section_id}
                href={reviewHref(r.section_id)}
                className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-[color:var(--color-surface-alt-2)]"
              >
                <span className="font-semibold text-text-primary">
                  {r.section_name}
                </span>
                <span className="text-text-muted">
                  {r.submitted} of {r.total_students} submitted
                  {toReview > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-primary">
                        {toReview} to review →
                      </span>
                    </>
                  )}
                  {r.flagged > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-[color:var(--color-error)]">
                        ⚑ {r.flagged}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sticky action bar — viewport-pinned footer with Preview as student
// (left) and Publish/Unpublish (right). Includes a small validation
// hint on the left when Publish is blocked, so the teacher knows what
// to fix without hovering the disabled button.
//
// When `confirming` is set, the bar replaces the normal row with a
// soft-confirm UI: what looks off (no due date, graph checklists not
// checked), a way to fix each, and "Publish anyway". Renders adjacent
// to the click target so the teacher doesn't have to hunt for the
// dialog after pressing Publish on a long-scrolled HW.
// ────────────────────────────────────────────────────────────────────
type PublishWarnings = {
  noDueDate: boolean;
  uncheckedChecklists: number;
  /** Graph problems whose checklist isn't written yet. */
  missingChecklists: number;
  /** The page has looked again for checklists being written; one still
   *  missing has failed to write, not just not landed yet. */
  checklistsLookedAgain: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The publish soft-confirm's warning. The no-due-date wording alone is
 *  unchanged from before checklists were checked. */
function publishWarning(w: PublishWarnings) {
  const parts = [
    w.uncheckedChecklists > 0 &&
      `${plural(w.uncheckedChecklists, "graph checklist hasn\u2019t", "graph checklists haven\u2019t")} been checked`,
    w.missingChecklists > 0 &&
      (w.checklistsLookedAgain
        ? `${plural(w.missingChecklists, "graph problem has", "graph problems have")} no checklist yet`
        : `${plural(w.missingChecklists, "graph checklist is", "graph checklists are")} still being written`),
  ].filter((p): p is string => !!p);
  if (parts.length === 0) return "Publish without a due date? Students will see \u201cno due date\u201d.";
  if (w.noDueDate) parts.push("there\u2019s no due date");
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts[0];
  return `${sentence}. Publish anyway?`;
}

function ActionBar({
  isPublished,
  canPublish,
  missingForPublish,
  pointsSummary,
  busy,
  previewLoading,
  onPublish,
  onUnpublish,
  onPreviewAsStudent,
  confirming,
  onReviewChecklists,
  onAddDueDate,
  onConfirmPublish,
}: {
  isPublished: boolean;
  canPublish: boolean;
  missingForPublish: string[];
  /** "100 points · 7 problems, 14–15 each", for a homework; null else. */
  pointsSummary: string | null;
  busy: boolean;
  previewLoading: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onPreviewAsStudent: () => void;
  /** Set while the publish soft-confirm is showing. */
  confirming: PublishWarnings | null;
  onReviewChecklists: () => void;
  onAddDueDate: () => void;
  onConfirmPublish: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-light bg-surface/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {confirming ? (
          <>
            <span className="min-w-0 flex-1 text-xs font-semibold text-[color:var(--color-warning-dark)] ">
              ⚠ {publishWarning(confirming)}
            </span>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {confirming.uncheckedChecklists + confirming.missingChecklists > 0 && (
                <button
                  type="button"
                  onClick={onReviewChecklists}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-bold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
                >
                  Review {confirming.uncheckedChecklists + confirming.missingChecklists === 1 ? "it" : "them"}
                </button>
              )}
              {confirming.noDueDate && (
                <button
                  type="button"
                  onClick={onAddDueDate}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-bold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
                >
                  Add due date
                </button>
              )}
              <button
                type="button"
                onClick={onConfirmPublish}
                disabled={busy}
                className="rounded-[--radius-md] bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                Publish anyway
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-[11px] text-text-muted">
              {!isPublished && missingForPublish.length > 0 ? (
                <span>Missing: {missingForPublish.join(", ")}</span>
              ) : (
                pointsSummary && (
                  <span className="text-text-secondary">
                    {pointsSummary}
                    {" · "}
                    <a href="#homework-points" className="font-semibold text-primary hover:underline">
                      Edit points
                    </a>
                  </span>
                )
              )}
            </div>
            {/* Same reason as the section-review action strip: allow a
                wrap on narrow screens instead of widening the page. */}
            <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:shrink-0">
              <button
                type="button"
                onClick={onPreviewAsStudent}
                disabled={busy || previewLoading}
                className="text-xs font-semibold text-text-secondary hover:text-primary disabled:opacity-50"
              >
                {previewLoading ? "Switching…" : "Preview as student →"}
              </button>
              {isPublished ? (
                <button
                  type="button"
                  onClick={onUnpublish}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-4 py-2 text-sm font-bold text-[color:var(--color-warning-dark)] hover:bg-[color:var(--color-warning-bg)] disabled:opacity-50  dark:bg-[color:var(--color-warning)]/10 "
                >
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={busy || !canPublish}
                  title={
                    canPublish
                      ? "Publish — locks the questions in the bank"
                      : `Missing: ${missingForPublish.join(", ")}`
                  }
                  className={`rounded-[--radius-md] px-5 py-2 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                    canPublish
                      ? "bg-green-600 hover:bg-green-700 hover:shadow"
                      : "cursor-not-allowed bg-gray-400 dark:bg-gray-600"
                  }`}
                >
                  Publish ▸
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Instructions block — student-visible notes the teacher writes for
// the homework (e.g. "Show all work, no calculators"). Click-to-edit
// textarea that autosaves on blur. Empty state shows a quiet "+ Add
// instructions for students" affordance so teachers who don't need
// it aren't visually nagged. Renders LaTeX inline so formulas like
// $a + b\sqrt{c}$ display correctly.
// ────────────────────────────────────────────────────────────────────
function InstructionsBlock({
  value,
  saveState,
  saveError,
  onChange,
}: {
  value: string | null;
  saveState: SaveState;
  saveError: string | null;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  // Tracks whether commit() just fired a save we're awaiting. Lets us
  // keep the textarea (and the teacher's typed text) on save-error,
  // and close it only on save-success — without this gate we'd either
  // close on every "saved" (breaking re-edits) or never close at all.
  const [committing, setCommitting] = useState(false);

  // React to the parent's saveState resolving AFTER a commit. On
  // "saved" we close the editor — but ONLY if the teacher hasn't
  // typed more characters since they blurred (draft would diverge
  // from value). When draft has moved past what we just saved, we
  // leave the editor open so the next blur can pick up the newer
  // text — losing those keystrokes on slow networks would surprise
  // the teacher. On "error" we always leave editing=true so the
  // typed text is retained for retry. Transitions while !committing
  // are ignored so a sibling field's save (e.g. units) can't close
  // our editor.
  //
  // Render-time state derivation rather than useEffect: avoids the
  // cascading-render lint, and the guard runs once per transition
  // because we flip committing=false in the same pass.
  if (committing && (saveState === "saved" || saveState === "error")) {
    setCommitting(false);
    if (
      saveState === "saved"
      && draft.trim() === (value ?? "").trim()
    ) {
      setEditing(false);
    }
  }

  const startEditing = () => {
    // Snapshot the current value into draft when entering edit mode.
    // We don't keep draft synced with value while idle (would risk
    // yanking text out from under a teacher whose committed text
    // hasn't propagated yet), so do the sync here, on user intent.
    setDraft(value ?? "");
    setEditing(true);
  };

  const cancel = () => {
    // Revert local edits and close — escape hatch for a stuck
    // save-error loop or a teacher who decided not to change anything
    // after all. Skips the save entirely so a previous error doesn't
    // re-fire.
    setDraft(value ?? "");
    setEditing(false);
    setCommitting(false);
  };

  const commit = () => {
    if (draft.trim() === (value ?? "").trim()) {
      setEditing(false);
      return;
    }
    onChange(draft);
    setCommitting(true);
    // editing stays true — the guard above closes it on save-success
    // when draft hasn't diverged from the saved value.
  };

  if (!editing) {
    if (!value) {
      return (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Instructions for students
            </span>
            <span className="text-[11px] font-normal normal-case tracking-normal text-text-muted">
              · optional
            </span>
          </div>
          <button
            type="button"
            onClick={startEditing}
            className="block w-full rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
          >
            + Add instructions students will see (e.g. &ldquo;Show all
            work, no calculators.&rdquo;)
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3 group">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Instructions for students
          </span>
          <InlineSavedHint state={saveState} errorMessage={saveError} />
        </div>
        {/* role=button instead of <button> because MathText can render
            display-math as a <div> for $$...$$ inputs, and a <div>
            inside a <button> is invalid HTML (hydration warnings,
            inconsistent click targets). The role+tabIndex+keyboard
            handlers reproduce native button semantics for keyboard
            and screen-reader users. */}
        <div
          role="button"
          tabIndex={0}
          onClick={startEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              startEditing();
            }
          }}
          className="block w-full cursor-pointer rounded-[--radius-md] border border-border-light bg-surface/50 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)]"
          title="Click to edit"
        >
          <div className="whitespace-pre-wrap">
            <MathText text={value} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Instructions for students
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Esc cancels the edit and reverts. preventDefault stops the
          // browser from also blurring (which would re-trigger commit).
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        autoFocus
        rows={3}
        maxLength={2000}
        placeholder='e.g. "Show all work and circle final answers. No calculators."'
        className="w-full rounded-[--radius-md] border border-primary bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
        <span>Visible to students. Supports inline LaTeX like $x^2$.</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            // mousedown preventDefault stops the textarea from blurring
            // (and re-firing commit) before our click handler runs;
            // keeps cancel a true escape rather than a hidden save.
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
            className="font-semibold text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <span className="tabular-nums">{draft.length}/2000</span>
        </div>
      </div>
    </div>
  );
}
