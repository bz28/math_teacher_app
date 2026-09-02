// The single registry of activity-log actions.
//
// Every action written by api/core/audit_log.record_activity appears
// here exactly once, and this file is the ONLY source for both the
// filter dropdown and the sentence rendered in a row's Details column.
// They used to be independent hardcoded lists, which is how the five
// user.* actions ended up filterable but rendered as an em-dash: two
// lists, one updated, nobody noticed. One list can still fall behind
// the backend, but it can no longer disagree with itself.
//
// Adding an action: add an entry here and it appears in the dropdown,
// gets a sentence, and picks up its family's badge colour. Nothing
// else to touch.

export type ActivityFamily =
  | "assignment"
  | "generation"
  | "grade"
  | "bank_item"
  | "user"
  | "student";

export interface ActivityAction {
  /** The exact `action` string on the log row. */
  action: string;
  /** Short human name — the dropdown option, and the row's badge unless
   *  `badgeLabel` overrides it. */
  label: string;
  /** Sentence for the Details column, from the row's small metadata. */
  detail: (m: Meta) => string;
  /** Optional per-row badge override. One endpoint can be two different
   *  actions to a teacher — PATCH covers both re-tagging and renaming —
   *  and a "Retagged" badge over a "Renamed …" sentence contradicts
   *  itself on the same row. The dropdown still offers only `label`,
   *  because the backend has one action string to filter on. */
  badgeLabel?: (m: Meta) => string;
}

type Meta = Record<string, unknown>;

const str = (m: Meta, k: string) => (m[k] == null ? "" : String(m[k]));
const num = (m: Meta, k: string) =>
  typeof m[k] === "number" ? (m[k] as number) : undefined;
const quoted = (m: Meta, k: string, fallback: string) =>
  str(m, k) ? `${fallback} "${str(m, k)}"` : fallback;
const plural = (n: number | undefined, word: string) =>
  `${n ?? "?"} ${word}${n === 1 ? "" : "s"}`;
// turn_index is how many prior messages the student had already sent, so
// the human-facing turn number is one more. Depth is the struggle
// signal — a 9th question on one step is a different event from a 1st.
const turn = (n: number | undefined) =>
  n === undefined ? undefined : n === 0 ? "first question" : `question ${n + 1}`;
const join = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(" · ");

// Content field keys as they're written by the backend, in the words a
// teacher would use for them.
const FIELD_NAMES: Record<string, string> = {
  question: "question",
  solution: "solution",
  solution_steps: "solution",
  final_answer: "final answer",
  distractors: "answer choices",
};

const fields = (m: Meta): string => {
  const raw = Array.isArray(m.fields) ? (m.fields as unknown[]) : [];
  return raw.map((f) => FIELD_NAMES[String(f)] ?? String(f)).join(", ");
};

export const ACTIVITY_FAMILIES: {
  family: ActivityFamily;
  /** Group heading in the dropdown. */
  label: string;
  /** The group's "everything in here" option. Spelled out per family
   *  rather than derived from `label` — lowercasing "AI generation"
   *  gave "All ai generation". */
  allLabel: string;
}[] = [
  { family: "assignment", label: "Assignments", allLabel: "All assignment actions" },
  { family: "generation", label: "AI generation", allLabel: "All generation actions" },
  { family: "grade", label: "Grading", allLabel: "All grading actions" },
  { family: "bank_item", label: "Question bank", allLabel: "All question-bank actions" },
  { family: "user", label: "User administration", allLabel: "All user actions" },
  // NOTE: `student` is deliberately absent. ACTIVITY_FAMILIES drives the
  // filter dropdown in TeacherActivitySection, which is scoped to ONE
  // teacher (`actor_user_id: teacherId`) — so a student group there
  // would be nine options that can only ever return zero rows, the exact
  // "reads as a broken filter" complaint this registry was built to fix.
  // The student entries still live in ACTIVITY_ACTIONS below, because
  // BY_ACTION is built from it and supplies the row sentences wherever a
  // surface does render student events.
];

export const ACTIVITY_ACTIONS: Record<ActivityFamily, ActivityAction[]> = {
  assignment: [
    {
      action: "assignment.create",
      label: "Created",
      detail: (m) => join(str(m, "title"), str(m, "type")) || "Created assignment",
    },
    {
      action: "assignment.update",
      label: "Edited",
      detail: (m) => join(str(m, "title"), str(m, "status")) || "Edited assignment",
    },
    {
      action: "assignment.publish",
      label: "Published",
      detail: (m) => quoted(m, "title", "Published"),
    },
    {
      action: "assignment.unpublish",
      label: "Unpublished",
      detail: (m) => quoted(m, "title", "Unpublished"),
    },
  ],

  generation: [
    {
      action: "generation.start",
      label: "Started generation",
      detail: (m) => {
        const mode = str(m, "mode");
        if (mode === "upload") return `Uploaded ${plural(num(m, "page_count"), "page")}`;
        const label = mode === "similar" ? "similar question" : "question";
        return `Generated ${plural(num(m, "requested_count"), label)}`;
      },
    },
  ],

  grade: [
    {
      action: "grade.save",
      label: "Saved grade",
      detail: (m) => {
        const sc = num(m, "final_score");
        return sc != null ? `Saved grade · ${sc}` : "Saved grade";
      },
    },
    {
      action: "grade.mark_reviewed",
      label: "Marked reviewed",
      detail: (m) => {
        const sc = num(m, "final_score");
        return sc != null ? `Marked reviewed · ${sc}` : "Marked reviewed";
      },
    },
    {
      action: "grade.unmark_reviewed",
      label: "Reopened",
      detail: () => "Reopened for review",
    },
    {
      action: "grade.publish",
      label: "Published grades",
      detail: (m) =>
        `Published ${plural(num(m, "published_count"), "grade")}` +
        (m.reviewed_only ? " (reviewed only)" : ""),
    },
  ],

  bank_item: [
    {
      action: "bank_item.approve",
      label: "Approved",
      detail: (m) => quoted(m, "title", "Approved item"),
    },
    {
      action: "bank_item.reject",
      label: "Rejected",
      detail: (m) => quoted(m, "title", "Rejected item"),
    },
    {
      action: "bank_item.edit",
      label: "Edited",
      detail: (m) => join(quoted(m, "title", "Edited item"), fields(m)),
    },
    {
      action: "bank_item.retag",
      label: "Retagged",
      // A rename and a re-tag are the same endpoint but read very
      // differently; `renamed_from` is what separates them.
      badgeLabel: (m) => (str(m, "renamed_from") ? "Renamed" : "Retagged"),
      detail: (m) =>
        join(
          str(m, "renamed_from")
            ? `Renamed "${str(m, "renamed_from")}" → "${str(m, "title")}"`
            : quoted(m, "title", "Retagged item"),
          // Appended rather than returned early, so a request that renames
          // AND re-tags doesn't silently drop half of what it recorded.
          str(m, "difficulty") && `difficulty ${str(m, "difficulty")}`,
          m.unit_id != null && "moved unit",
        ),
    },
    {
      action: "bank_item.regenerate",
      label: "Regenerated",
      detail: (m) =>
        join(
          quoted(m, "title", "Regenerated item"),
          str(m, "mode") === "guided" ? "guided revision" : "fresh take",
        ),
    },
    {
      action: "bank_item.workshop_chat",
      label: "Asked the AI",
      detail: (m) => quoted(m, "title", "Asked the AI about"),
    },
    {
      action: "bank_item.workshop_accept",
      label: "Accepted proposal",
      detail: (m) => join(quoted(m, "title", "Accepted AI proposal for"), fields(m)),
    },
    {
      action: "bank_item.workshop_discard",
      label: "Discarded proposal",
      detail: (m) => quoted(m, "title", "Discarded AI proposal for"),
    },
    {
      action: "bank_item.revert",
      label: "Undid edit",
      detail: (m) =>
        join(
          quoted(m, "title", "Undid edit to"),
          // The whole reason this action is logged: Undo restores the
          // pre-edit status too, which is what the generation-quality
          // board reads. Say so on the row, or the board and this
          // timeline appear to contradict each other.
          str(m, "restored_status") && `status back to ${str(m, "restored_status")}`,
        ),
    },
    {
      action: "bank_item.delete",
      label: "Deleted",
      detail: (m) =>
        join(
          quoted(m, "title", "Deleted item"),
          str(m, "status") && `was ${str(m, "status")}`,
        ),
    },
  ],

  user: [
    {
      action: "user.role_change",
      label: "Changed role",
      detail: (m) => `${str(m, "old_role") || "?"} → ${str(m, "new_role") || "?"}`,
    },
    {
      action: "user.subscription_change",
      label: "Changed subscription",
      detail: (m) =>
        join(
          `${str(m, "old_tier")}/${str(m, "old_status")} → ` +
            `${str(m, "new_tier")}/${str(m, "new_status")}`,
          m.stripe_cancelled === true && "Stripe cancelled",
        ),
    },
    {
      action: "user.activate",
      label: "Activated",
      detail: (m) => join("Activated", str(m, "email"), str(m, "role")),
    },
    {
      action: "user.deactivate",
      label: "Deactivated",
      detail: (m) => join("Deactivated", str(m, "email"), str(m, "role")),
    },
    {
      action: "user.delete",
      label: "Deleted user",
      detail: (m) => join("Deleted", str(m, "email"), str(m, "role")),
    },
  ],
  // Student lifecycle milestones. These are the half of a homework the
  // log used to miss entirely — without them a timeline jumps from
  // "teacher published" to "teacher graded" with the actual work
  // invisible in between. Metadata is ids and counts only (FERPA: this
  // table never holds student content), so the sentences describe the
  // SHAPE of what happened and deep-link for the substance.
  student: [
    {
      action: "submission.create",
      label: "Submitted homework",
      detail: (m) =>
        join(
          `Submitted ${plural(num(m, "file_count"), "file")}`,
          m.is_late ? "late" : undefined,
        ),
    },
    {
      action: "submission.confirm_extraction",
      label: "Confirmed reading",
      detail: (m) => {
        const n = num(m, "corrections_count");
        return n
          ? `Confirmed the reading after ${plural(n, "correction")}`
          : "Confirmed the reading as-is";
      },
    },
    {
      action: "submission.flag_extraction",
      label: "Flagged reading",
      detail: () => "Said the reader got something wrong — sent for manual grading",
    },
    {
      action: "practice.next_variation",
      label: "Served practice",
      detail: (m) =>
        str(m, "mode") === "learn"
          ? "Served a Learn variation"
          : "Served a practice variation",
    },
    {
      action: "practice.learn_start",
      label: "Started Learn",
      detail: () => "Pivoted a practised problem into a Learn walkthrough",
    },
    {
      action: "consumption.complete",
      label: "Finished problem",
      detail: (m) => join("Finished a problem", str(m, "context")),
    },
    {
      action: "consumption.flag",
      // The one endpoint toggles both ways, so the badge has to read
      // from the row or an un-flag renders as "Flagged".
      label: "Flagged problem",
      badgeLabel: (m) => (m.flagged ? "Flagged problem" : "Un-flagged problem"),
      detail: (m) =>
        m.flagged
          ? "Flagged a problem to revisit"
          : "Removed a flag from a problem",
    },
    {
      action: "tutor.step_chat",
      label: "Asked about a step",
      detail: (m) =>
        join(
          `Asked about step ${(num(m, "step_index") ?? 0) + 1}`,
          turn(num(m, "turn_index")),
        ),
    },
    {
      action: "tutor.problem_chat",
      label: "Asked about a problem",
      detail: (m) => join("Asked about the whole problem", turn(num(m, "turn_index"))),
    },
  ],
};

const BY_ACTION: Map<string, ActivityAction> = new Map(
  Object.values(ACTIVITY_ACTIONS)
    .flat()
    .map((a) => [a.action, a]),
);

export function actionLabel(action: string, metadata?: Meta | null): string {
  const entry = BY_ACTION.get(action);
  if (!entry) return action;
  return (metadata && entry.badgeLabel?.(metadata)) || entry.label;
}

/**
 * The Details sentence for one row.
 *
 * An action with no registry entry falls back to its raw metadata keys
 * rather than an em-dash. Losing the sentence when the backend adds an
 * action is tolerable; silently showing "—" over real data is what let
 * five actions look empty for months.
 */
export function activityDetail(action: string, metadata: Meta | null): string {
  if (!metadata) return "—";
  const entry = BY_ACTION.get(action);
  if (entry) return entry.detail(metadata) || "—";
  const raw = Object.entries(metadata)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
  return raw || "—";
}

export function actionFamily(action: string): string {
  return action.split(".")[0];
}
