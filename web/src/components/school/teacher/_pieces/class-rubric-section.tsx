"use client";

import { useEffect, useRef, useState } from "react";
import {
  teacher,
  type ClassRubricRule,
  type ClassRubricRuleInput,
} from "@/lib/api";
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
      .then((res) => !cancelled && setRules(res.rules))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const save = (next: ClassRubricRuleInput[]) => {
    const prev = rules;
    setSaveState("saving");
    setSaveError(null);
    return teacher
      .updateCourseRubric(courseId, next)
      .then((res) => {
        setRules(res.rules);
        setSaveState("saved");
        return true;
      })
      .catch((e: unknown) => {
        setRules(prev);
        setSaveState("error");
        setSaveError(e instanceof Error ? e.message : "Couldn't save");
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
              Points come off a problem when the rule is broken. Leave blank and the AI decides.
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
      <p className="mt-2 text-xs text-text-muted">
        Changes apply to homework graded from now on. Grades already given don&apos;t change.
      </p>
    </section>
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
