/**
 * What stands between a homework and Publish — one set of rules for every
 * place that offers the button (the homework page's action bar, and the
 * question review's "All caught up" screen), so they can't disagree.
 *
 * Hard requirements (`missingForPublishOf`) disable Publish. Warnings
 * (`publishChecks`) are usually mistakes but publishing anyway is a
 * valid choice, so they turn a Publish click into a soft confirm.
 */

interface PublishableHomework {
  type: string;
  due_at: string | null;
  unit_ids: string[];
  graph_checklists?: Record<
    string,
    { checklist: { asks_for_drawing: boolean; checked: boolean } | null; can_write: boolean }
  >;
}

interface PublishableProblem {
  bank_item_id: string;
}

/** Sections are NOT required: the backend fans out to every section in
 *  the course when the teacher publishes with an empty list. The picker
 *  is for exclusions ("Period 5 doesn't get this yet"), not the happy
 *  path. */
export function missingForPublishOf(
  hw: PublishableHomework | null | undefined,
  problems: PublishableProblem[],
): string[] {
  const missing: string[] = [];
  if (hw) {
    if (problems.length === 0) missing.push("at least one problem");
    if (hw.unit_ids.length === 0) missing.push("a unit");
  }
  return missing;
}

/** If the HW has no due date, or graph checklists the teacher hasn't
 *  checked, a Publish click shows a soft confirm first. Practice has no
 *  due date and no checklists, so it publishes directly. */
export function publishChecks<P extends PublishableProblem>(
  hw: PublishableHomework | null | undefined,
  problems: P[],
) {
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
  const anyPublishWarning =
    noDueDate || uncheckedChecklists.length > 0 || missingChecklists.length > 0;
  return { noDueDate, uncheckedChecklists, missingChecklists, anyPublishWarning };
}

export type PublishWarnings = {
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
export function publishWarning(w: PublishWarnings) {
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
