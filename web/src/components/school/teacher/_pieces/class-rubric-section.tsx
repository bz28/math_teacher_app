"use client";

import { useEffect, useRef, useState } from "react";
import {
  teacher,
  type ClassRubric,
  type ClassRubricRule,
  type ClassRubricRuleInput,
  type RubricSuggestion,
} from "@/lib/api";
import { CREDIT_DEFAULTS } from "@/lib/rubric";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";

// Common standards a teacher can add in one tap. Each hides once a rule
// on the same topic exists (matched loosely — a teacher's own wording of
// "units" shouldn't leave a duplicate suggestion sitting under it).
const COMMON_RULES: { text: string; topic: RegExp }[] = [
  { text: "Final answers need units.", topic: /\bunits?\b/i },
  { text: "Label every key point on graphs.", topic: /\blabel/i },
  { text: "Show work for full credit.", topic: /\bshow (your )?work\b/i },
  { text: "Exact answers unless the problem says to round.", topic: /\b(exact|round)/i },
];

const MAX_RULES = 30;
const MAX_RULE_CHARS = 300;

const inputClass =
  "w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none";

/** Parse the points box: blank = the AI sizes it; else a whole 0–100. */
function parsePoints(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : "invalid";
}

function originLine(r: ClassRubricRule): string {
  if (r.source === "suggestion" && r.source_label) return `Added while grading ${r.source_label}`;
  if (!r.added_at) return "";
  const d = new Date(r.added_at);
  return `Added ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * Class settings → Grading rubric. The class's standing rules, applied by
 * the AI to every homework in the course (a homework can skip one or add
 * its own). Each edit saves the whole list immediately; ids are kept, so
 * grades that already cite a rule stay linked to it.
 */
export function ClassRubricSection({
  courseId,
  courseName,
}: {
  courseId: string;
  courseName: string;
}) {
  // null = loading; the list once loaded.
  const [rules, setRules] = useState<ClassRubricRule[] | null>(null);
  // The revision these rules were loaded at — sent with every save so a
  // save can't overwrite rules added elsewhere (a review page, a tab).
  const [rev, setRev] = useState(0);
  // The class's full/partial credit guidance; null until loaded.
  const [credit, setCredit] = useState<Pick<ClassRubric, "full_credit" | "partial_credit"> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newPoints, setNewPoints] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const newRuleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .courseRubric(courseId)
      .then((res) => {
        if (cancelled) return;
        setRules(res.rules);
        setRev(res.rev);
        setCredit({ full_credit: res.full_credit, partial_credit: res.partial_credit });
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const save = (next: ClassRubricRuleInput[]) => {
    setSaveState("saving");
    setSaveError(null);
    return teacher
      .updateCourseRubric(courseId, next, rev)
      .then((res) => {
        setRules(res.rules);
        setRev(res.rev);
        setSaveState("saved");
        return true;
      })
      .catch((e: unknown) => {
        setSaveState("error");
        setSaveError(e instanceof Error ? e.message : "Couldn't save");
        // The rules may have moved on (a 409): show what's there now.
        teacher
          .courseRubric(courseId)
          .then((res) => {
            setRules(res.rules);
            setRev(res.rev);
          })
          .catch(() => undefined);
        return false;
      });
  };

  const asInputs = (list: ClassRubricRule[]): ClassRubricRuleInput[] =>
    list.map((r) => ({ id: r.id, text: r.text, points: r.points }));

  const addRule = async (text: string, pointsRaw: string) => {
    if (!rules) return;
    const t = text.trim();
    const points = parsePoints(pointsRaw);
    if (!t) return setNewError("Write the rule first.");
    if (points === "invalid") return setNewError("Points must be a whole number from 0 to 100.");
    if (rules.length >= MAX_RULES) return setNewError(`A class can have up to ${MAX_RULES} rules.`);
    setNewError(null);
    if (await save([...asInputs(rules), { text: t, points }])) {
      setNewText("");
      setNewPoints("");
    }
  };

  const updateRule = async (id: string, text: string, pointsRaw: string): Promise<string | null> => {
    if (!rules) return null;
    const t = text.trim();
    const points = parsePoints(pointsRaw);
    if (!t) return "A rule needs some text.";
    if (points === "invalid") return "Points must be a whole number from 0 to 100.";
    const ok = await save(asInputs(rules).map((r) => (r.id === id ? { id, text: t, points } : r)));
    if (!ok) return "Couldn't save this rule. Try again.";
    closeEditor(id);
    return null;
  };

  const removeRule = async (id: string) => {
    if (!rules) return;
    if (await save(asInputs(rules).filter((r) => r.id !== id))) {
      setEditingId(null);
      // The row is gone; put focus somewhere that still exists.
      newRuleRef.current?.focus();
    }
  };

  // Closing the editor returns focus to that rule's Edit button, so a
  // keyboard user isn't dropped back to the top of the page.
  const closeEditor = (id: string) => {
    setEditingId(null);
    requestAnimationFrame(() => editButtons.current.get(id)?.focus());
  };

  const suggestions = COMMON_RULES.filter(
    (c) => !(rules ?? []).some((r) => c.topic.test(r.text)),
  ).map((c) => c.text);

  return (
    <section aria-labelledby="class-rubric-heading" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="class-rubric-heading"
          className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary"
        >
          Grading rubric
        </h2>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
        The AI follows these rules on every homework in {courseName}. A homework can skip one or
        add its own. You still approve every grade.
      </p>

      <div className="mt-4 rounded-[--radius-md] border border-border-light bg-surface p-5">
        {loadError && (
          <p className="text-sm text-text-secondary">Couldn&apos;t load your rules. Refresh to try again.</p>
        )}
        {!loadError && rules === null && <p className="text-sm text-text-muted">Loading…</p>}

        {rules !== null && rules.length === 0 && (
          <p className="text-sm text-text-secondary">
            No rules yet. Add the standards you grade by — like units on final answers — and the
            AI will apply them.
          </p>
        )}

        {rules !== null && rules.length > 0 && (
          <ul className="divide-y divide-border-light">
            {rules.map((r) =>
              editingId === r.id ? (
                <RuleEditor
                  key={r.id}
                  rule={r}
                  saving={saveState === "saving"}
                  onSave={(text, points) => updateRule(r.id, text, points)}
                  onRemove={() => removeRule(r.id)}
                  onCancel={() => closeEditor(r.id)}
                />
              ) : (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-text-primary">{r.text}</p>
                    {originLine(r) && (
                      <p className="mt-0.5 text-xs text-text-muted">{originLine(r)}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm font-semibold ${
                      r.points === null ? "text-text-muted" : "text-[color:var(--color-error)]"
                    }`}
                    title={r.points === null ? "The AI decides how much to take off" : undefined}
                  >
                    {r.points === null ? "AI sizes" : `−${r.points}`}
                  </span>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) editButtons.current.set(r.id, el);
                      else editButtons.current.delete(r.id);
                    }}
                    onClick={() => setEditingId(r.id)}
                    aria-label={`Edit rule: ${r.text}`}
                    className="min-h-10 shrink-0 rounded-[--radius-sm] px-2 text-sm font-semibold text-primary hover:bg-primary-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Edit
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        {rules !== null && (
          <form
            className={`${rules.length ? "mt-4 border-t border-border-light pt-4" : "mt-4"}`}
            onSubmit={(e) => {
              e.preventDefault();
              void addRule(newText, newPoints);
            }}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="new-rule" className="sr-only">New rule</label>
              <input
                id="new-rule"
                ref={newRuleRef}
                type="text"
                value={newText}
                maxLength={MAX_RULE_CHARS}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Add a rule, e.g. “Round to two decimal places.”"
                className={inputClass}
              />
              <div className="flex gap-2">
                <label htmlFor="new-rule-points" className="sr-only">Points off</label>
                <input
                  id="new-rule-points"
                  type="text"
                  inputMode="numeric"
                  value={newPoints}
                  onChange={(e) => setNewPoints(e.target.value)}
                  placeholder="Pts"
                  className={`${inputClass} w-20`}
                />
                <button
                  type="submit"
                  disabled={saveState === "saving"}
                  className="min-h-10 shrink-0 rounded-[--radius-md] bg-primary px-4 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  Add rule
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Points come off a problem when the rule is broken, never more than the problem is
              worth. Leave blank and the AI decides.
            </p>
            {newError && (
              <p className="mt-1 text-xs text-[color:var(--color-error)]">{newError}</p>
            )}
          </form>
        )}

        {rules !== null && suggestions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-text-muted">Common rules — tap to add</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={saveState === "saving"}
                  onClick={() => void addRule(t, "")}
                  className="min-h-10 rounded-full border border-primary/25 bg-primary-bg px-3 text-[13px] font-medium text-primary hover:border-primary/50 disabled:opacity-50"
                >
                  + {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {credit && (
        <CreditGuidance
          courseId={courseId}
          credit={credit}
          onSaved={setCredit}
        />
      )}
      <p className="mt-2 text-xs text-text-muted">
        Changes apply to homework graded from now on. Grades already given don&apos;t change.
      </p>
      <DeclinedSuggestions
        courseId={courseId}
        onAdded={(next, nextRev) => {
          setRules(next);
          setRev(nextRev);
        }}
      />
    </section>
  );
}

type CreditField = "full_credit" | "partial_credit";

const CREDIT_FIELDS: { field: CreditField; label: string }[] = [
  { field: "full_credit", label: "Full credit when" },
  { field: "partial_credit", label: "Partial credit" },
];

/**
 * "When no rule covers a mistake": the class's full and partial credit
 * guidance, which the AI uses for anything no rule names. Pre-filled with
 * the standard text; saving it unchanged (or cleared) stores nothing, so
 * the class keeps following the standard text if it's ever improved.
 */
function CreditGuidance({
  courseId,
  credit,
  onSaved,
}: {
  courseId: string;
  credit: Pick<ClassRubric, CreditField>;
  onSaved: (credit: Pick<ClassRubric, CreditField>) => void;
}) {
  // null = show the saved value; a string = the teacher is typing.
  const [drafts, setDrafts] = useState<Record<CreditField, string | null>>({
    full_credit: null,
    partial_credit: null,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const shown = (f: CreditField) => drafts[f] ?? credit[f] ?? CREDIT_DEFAULTS[f];
  const stored = (text: string, f: CreditField): string | null => {
    const t = text.trim();
    return !t || t === CREDIT_DEFAULTS[f] ? null : t;
  };

  const save = (next: Pick<ClassRubric, CreditField>) => {
    setSaveState("saving");
    setSaveError(null);
    teacher
      .updateCourseCredit(courseId, next)
      .then((res) => {
        onSaved({ full_credit: res.full_credit, partial_credit: res.partial_credit });
        setSaveState("saved");
      })
      .catch((e: unknown) => {
        setSaveState("error");
        setSaveError(e instanceof Error ? e.message : "Couldn't save");
      });
  };

  const commit = (f: CreditField) => {
    const draft = drafts[f];
    if (draft === null) return;
    setDrafts((d) => ({ ...d, [f]: null }));
    const value = stored(draft, f);
    if (value === credit[f]) return;
    save({ ...credit, [f]: value });
  };

  return (
    <section aria-labelledby="credit-guidance-heading" className="mt-4 rounded-[--radius-md] border border-border-light bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id="credit-guidance-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]"
        >
          When no rule covers a mistake
        </h3>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
        The AI sizes those mistakes itself, using this guidance. Its deductions are marked
        &ldquo;AI judgment&rdquo; on the review page, so you know which to check.
      </p>
      <div className="mt-4 space-y-4">
        {CREDIT_FIELDS.map(({ field, label }) => {
          const id = `class-${field}`;
          const usingStandard = drafts[field] === null && credit[field] === null;
          return (
            <div key={field}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-sm font-semibold text-text-primary">
                  {label}
                  {usingStandard && (
                    <span className="ml-1.5 text-xs font-normal text-text-muted">· standard guidance</span>
                  )}
                </label>
                {credit[field] !== null && drafts[field] === null && (
                  <button
                    type="button"
                    onClick={() => save({ ...credit, [field]: null })}
                    disabled={saveState === "saving"}
                    className="min-h-8 rounded-[--radius-sm] px-2 text-xs font-semibold text-primary hover:bg-primary-bg disabled:opacity-50"
                  >
                    Use the standard guidance
                  </button>
                )}
              </div>
              <textarea
                id={id}
                value={shown(field)}
                onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                onBlur={() => commit(field)}
                maxLength={2000}
                rows={4}
                className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Rules the app offered after a lowered grade and the teacher declined.
 * Declined offers are never made again, so this is where a "no" can be
 * undone. Hidden when there are none.
 */
function DeclinedSuggestions({
  courseId,
  onAdded,
}: {
  courseId: string;
  onAdded: (rules: ClassRubricRule[], rev: number) => void;
}) {
  const [items, setItems] = useState<RubricSuggestion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .rubricSuggestions(courseId, "declined")
      .then((res) => !cancelled && setItems(res.suggestions))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (!items || items.length === 0) return null;

  const add = async (s: RubricSuggestion) => {
    setBusyId(s.id);
    setError(null);
    try {
      const res = await teacher.decideRubricSuggestion(s.id, { action: "add_class" });
      onAdded(res.rules, res.rev);
      setItems((list) => (list ?? []).filter((x) => x.id !== s.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add it. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <details className="mt-4 rounded-[--radius-md] border border-border-light bg-surface">
      <summary className="flex min-h-10 cursor-pointer items-center px-4 text-sm font-semibold text-primary">
        Suggestions you declined ({items.length})
      </summary>
      <ul className="divide-y divide-border-light border-t border-border-light px-4">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm text-text-primary">{s.text}</p>
              {s.source_label && (
                <p className="mt-0.5 text-xs text-text-muted">Suggested while grading {s.source_label}</p>
              )}
            </div>
            {s.points !== null && (
              <span className="font-mono text-sm font-semibold text-text-secondary">−{s.points}</span>
            )}
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void add(s)}
              aria-label={`Add “${s.text}” to the class rubric`}
              className="min-h-10 rounded-[--radius-md] px-3 text-sm font-semibold text-primary hover:bg-primary-bg disabled:opacity-50"
            >
              {busyId === s.id ? "Adding…" : "Add to rubric"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-xs text-[color:var(--color-error)]">{error}</p>}
    </details>
  );
}

function RuleEditor({
  rule,
  saving,
  onSave,
  onRemove,
  onCancel,
}: {
  rule: ClassRubricRule;
  saving: boolean;
  onSave: (text: string, points: string) => Promise<string | null>;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(rule.text);
  const [points, setPoints] = useState(rule.points === null ? "" : String(rule.points));
  const [error, setError] = useState<string | null>(null);
  const textId = `rule-${rule.id}-text`;
  const pointsId = `rule-${rule.id}-points`;
  return (
    <li className="py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(text, points).then(setError);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={textId} className="sr-only">Rule</label>
          <input
            id={textId}
            type="text"
            autoFocus
            value={text}
            maxLength={MAX_RULE_CHARS}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onCancel()}
            className={inputClass}
          />
          <label htmlFor={pointsId} className="sr-only">Points off</label>
          <input
            id={pointsId}
            type="text"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="Pts"
            className={`${inputClass} sm:w-20`}
          />
        </div>
        {error && <p className="mt-1 text-xs text-[color:var(--color-error)]">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-10 rounded-[--radius-md] bg-primary px-3.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 rounded-[--radius-md] px-3 text-sm font-semibold text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={saving}
            className="ml-auto min-h-10 rounded-[--radius-md] px-3 text-sm font-semibold text-[color:var(--color-error)] hover:bg-[color:var(--color-error-light)] disabled:opacity-50"
          >
            Remove rule
          </button>
        </div>
      </form>
    </li>
  );
}
