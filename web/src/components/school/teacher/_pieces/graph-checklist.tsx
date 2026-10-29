"use client";

import { useState } from "react";
import { teacher, type GraphChecklistItem, type HomeworkGraphChecklist } from "@/lib/api";
import { numberInputClass } from "@/components/school/teacher/_pieces/problem-points";
import { splitValues } from "@/lib/checklist-values";

const MAX_ITEMS = 6;
const MAX_ITEM_CHARS = 200;

const capClass =
  "text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]";
const linkButtonClass =
  "min-h-8 rounded-[--radius-sm] px-1.5 text-xs font-semibold text-primary hover:bg-primary-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

type Draft = {
  text: string;
  points: string;
  rule_id: string | null;
  rule_text: string | null;
  /** Set when the linked rule fixes the item's points. */
  rule_points: number | null;
};

const EMPTY_DRAFT: Draft = { text: "", points: "1", rule_id: null, rule_text: null, rule_points: null };

/** What an item counts for, as the save checks it: the rule's points
 *  when its rule sets some, else its own. */
const draftPoints = (d: Draft) => d.rule_points ?? (Number(d.points) || 0);

/**
 * Inside a graph problem's "Grading ▾": what the drawing must show, each
 * feature worth points, and how the problem splits between the graph and
 * the written work. Written by the AI from the answer key when the
 * question is approved; the teacher can edit it or have it written again.
 */
export function GraphChecklistPanel({
  entry,
  bankItemId,
  problemPoints,
  lookedAgain,
  onChanged,
  onEditQuestion,
}: {
  entry: HomeworkGraphChecklist;
  bankItemId: string;
  problemPoints: number;
  /** The page has looked once more since loading (a checklist being
   *  written in the background has had time to land). */
  lookedAgain: boolean;
  /** Re-read the checklists after a save; throws when the read fails. */
  onChanged: () => Promise<void>;
  /** Opens the question in the Workshop; absent once published. */
  onEditQuestion?: () => void;
}) {
  const { checklist, can_write } = entry;
  const [editing, setEditing] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRewrite, setConfirmRewrite] = useState(false);

  // After a save, the new checklist replaces the old one only once it
  // has been read back, so the old one never flashes in between.
  const reread = async () => {
    try {
      await onChanged();
    } catch {
      setError("Saved, but the new checklist didn't load. Reload the page to see it.");
    }
  };

  const startEditing = (drafts: Draft[]) => {
    setError(null);
    setConfirmRewrite(false);
    setEditing(drafts);
  };

  const rewrite = async () => {
    setBusy(true);
    setError(null);
    try {
      await teacher.rewriteGraphChecklist(bankItemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the checklist. Try again.");
      setBusy(false);
      return;
    }
    await reread();
    setConfirmRewrite(false);
    setBusy(false);
  };

  const markChecked = async () => {
    setBusy(true);
    setError(null);
    try {
      await teacher.markGraphChecklistChecked(bankItemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      setBusy(false);
      return;
    }
    await reread();
    setBusy(false);
  };

  const save = async (drafts: Draft[]) => {
    const items = drafts.map((d) => ({
      text: d.text.trim(),
      points: Number(d.points),
      rule_id: d.rule_id,
    }));
    if (items.some((i) => !i.text)) return setError("Every item needs a description.");
    if (items.some((i) => !Number.isInteger(i.points) || i.points < 1))
      return setError("Points are whole numbers, at least 1.");
    setBusy(true);
    setError(null);
    try {
      await teacher.updateGraphChecklist(bankItemId, items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the checklist.");
      setBusy(false);
      return;
    }
    await reread();
    setEditing(null);
    setBusy(false);
  };

  if (editing) {
    return (
      <ChecklistEditor
        drafts={editing}
        problemPoints={problemPoints}
        busy={busy}
        error={error}
        onChange={setEditing}
        onCancel={() => {
          setEditing(null);
          setError(null);
        }}
        onSave={save}
      />
    );
  }

  if (!can_write) {
    return (
      <Section>
        <p className="text-xs text-text-secondary">
          Add the final answer and a checklist of what the graph must show is
          written from it.
          {onEditQuestion && (
            <>
              {" "}
              <button type="button" onClick={onEditQuestion} className={linkButtonClass}>
                Add the answer ↗
              </button>
            </>
          )}
        </p>
      </Section>
    );
  }

  if (!checklist) {
    return (
      <Section>
        <p className="text-xs text-text-secondary" aria-live="polite">
          {lookedAgain
            ? "No checklist yet."
            : "Writing the checklist from the answer key…"}
          {lookedAgain && (
            <>
              {" "}
              <button type="button" onClick={rewrite} disabled={busy} className={linkButtonClass}>
                {busy ? "Writing…" : "Write it now"}
              </button>
            </>
          )}
        </p>
        <ErrorLine error={error} />
      </Section>
    );
  }

  if (!checklist.asks_for_drawing) {
    return (
      <Section>
        <p className="text-xs leading-relaxed text-text-secondary">
          This question doesn&rsquo;t seem to ask for a drawing, so it has no
          graph checklist and is graded like any other problem.
          {onEditQuestion
            ? " If that\u2019s right, turn off \u201cRequires a drawing\u201d on the question."
            : " If it does ask for one, write the checklist yourself."}
        </p>
        <div className="-ml-1.5 flex flex-wrap gap-1">
          <button type="button" onClick={() => startEditing([EMPTY_DRAFT])} className={linkButtonClass}>
            Write a checklist anyway
          </button>
          {onEditQuestion && (
            <button type="button" onClick={onEditQuestion} className={linkButtonClass}>
              Open the question ↗
            </button>
          )}
        </div>
        <ErrorLine error={error} />
      </Section>
    );
  }

  return (
    <Section
      actions={
        <>
          {checklist.checked ? (
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] text-text-secondary">
              {checklist.teacher_edited ? "Edited by you" : "Checked by you"}
            </span>
          ) : (
            <button
              type="button"
              onClick={markChecked}
              disabled={busy}
              className="min-h-8 rounded-[--radius-sm] border border-primary/40 bg-primary-bg/40 px-2 text-xs font-semibold text-primary hover:bg-primary-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              Looks right
            </button>
          )}
          <button
            type="button"
            onClick={() => startEditing(checklist.items.map(toDraft))}
            disabled={busy}
            className={linkButtonClass}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => (checklist.teacher_edited ? setConfirmRewrite(true) : void rewrite())}
            disabled={busy}
            className={linkButtonClass}
          >
            {busy ? (
              "Writing…"
            ) : (
              <>
                Rewrite<span className="sr-only sm:not-sr-only"> from answer key</span>
              </>
            )}
          </button>
        </>
      }
    >
      {confirmRewrite && (
        <div
          role="group"
          aria-label="Replace your checklist"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[--radius-sm] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)]/60 px-3 py-2 text-xs text-text-primary"
        >
          <span>Replace your edits with a fresh checklist from the answer key?</span>
          <span className="flex gap-1">
            <button type="button" onClick={() => setConfirmRewrite(false)} className={linkButtonClass}>
              Keep mine
            </button>
            <button
              type="button"
              onClick={rewrite}
              disabled={busy}
              className="min-h-8 rounded-[--radius-sm] bg-primary px-2.5 text-xs font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {busy ? "Writing…" : "Replace"}
            </button>
          </span>
        </div>
      )}
      {!checklist.checked && (
        <p className="text-xs text-text-secondary">
          Written by AI from the answer key. Every student&rsquo;s drawing is
          graded against it, so check it before you publish.
        </p>
      )}
      <ul className="space-y-1.5">
        {checklist.items.map((item, i) => (
          <ItemRow key={i} item={item} />
        ))}
      </ul>
      <SplitBar graph={checklist.graph_points} problem={problemPoints} />
      <ErrorLine error={error} />
    </Section>
  );
}

function toDraft(item: GraphChecklistItem): Draft {
  return {
    text: item.text,
    points: String(item.points),
    rule_id: item.rule_id,
    rule_text: item.rule_text,
    rule_points: item.rule_points,
  };
}

function Section({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border-light pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={capClass}>What the graph must show</span>
        {/* -ml-1.5: the buttons' padding, so their text lines up with the caption when they wrap. */}
        {actions && <span className="-ml-1.5 flex flex-wrap items-center gap-1">{actions}</span>}
      </div>
      {children}
    </div>
  );
}

function ItemRow({ item }: { item: GraphChecklistItem }) {
  const parts = splitValues(item.text, item.values_to_check);
  const marked = new Set(parts.flatMap((p) => p.values ?? []));
  const unmarked = item.values_to_check.filter((v) => !marked.has(v));
  const one = item.values_to_check.length === 1;
  return (
    <li className="flex items-start justify-between gap-3 rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-2 sm:px-3">
      <div className="min-w-0">
        <p className="text-sm leading-snug text-text-primary">
          {parts.map((p, i) =>
            p.values ? (
              <mark
                key={i}
                className="bg-transparent text-inherit underline decoration-[color:var(--color-warning)] decoration-2 underline-offset-[3px]"
              >
                {p.text}
              </mark>
            ) : (
              p.text
            ),
          )}
        </p>
        {item.rule_id && (
          <p className="mt-0.5 text-[11px] text-primary">
            Class rule{item.rule_text ? ` · ${item.rule_text}` : ""}
          </p>
        )}
        {item.values_to_check.length > 0 && (
          <p className="mt-0.5 text-[11px] text-[color:var(--color-warning-dark)]">
            {unmarked.length === 0
              ? `Check the underlined ${one ? "value" : "values"}`
              : `Check ${one ? "this value" : "these values"}: ${item.values_to_check.join(", ")}`}
            . The answer key doesn&rsquo;t give {one ? "it" : "them"}, so the AI worked{" "}
            {one ? "it" : "them"} out.
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-text-primary">
        {item.points}
        <span className="ml-1 font-sans text-xs font-normal text-text-muted">
          {item.points === 1 ? "pt" : "pts"}
        </span>
      </span>
    </li>
  );
}

/** How the problem's points split: the graph part (checked from the
 *  drawing) and the rest (the written work and answer). */
function SplitBar({ graph, problem }: { graph: number; problem: number }) {
  const over = graph >= problem;
  const share = problem > 0 ? Math.min(100, (graph / problem) * 100) : 0;
  return (
    <div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-bg-subtle"
        role="img"
        aria-label={`Graph ${graph} of ${problem} points`}
      >
        <span
          className={over ? "bg-[color:var(--color-error)]" : "bg-primary"}
          style={{ width: `${share}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-text-muted">
        <span>
          <b className={over ? "text-[color:var(--color-error)]" : "text-primary"}>Graph {graph}</b> ·
          checked from the drawing
        </span>
        <span>
          Work and answer {Math.max(0, problem - graph)} · graded with the rules below
        </span>
      </div>
      {over && (
        <p role="alert" className="mt-1 text-[11px] text-[color:var(--color-error)]">
          The graph can be worth at most {problem - 1} of {problem} points: leave at least 1
          for the work and answer.
        </p>
      )}
    </div>
  );
}

function ChecklistEditor({
  drafts,
  problemPoints,
  busy,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  drafts: Draft[];
  problemPoints: number;
  busy: boolean;
  error: string | null;
  onChange: (d: Draft[]) => void;
  onCancel: () => void;
  onSave: (d: Draft[]) => void;
}) {
  const set = (i: number, patch: Partial<Draft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const graph = drafts.reduce((sum, d) => sum + draftPoints(d), 0);
  const over = graph >= problemPoints;
  return (
    <Section>
      <ul className="space-y-1.5">
        {drafts.map((d, i) => (
          <li
            key={i}
            className="rounded-[--radius-sm] border border-border-light bg-surface px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <textarea
                value={d.text}
                maxLength={MAX_ITEM_CHARS}
                rows={1}
                aria-label={`Item ${i + 1}`}
                onChange={(e) => set(i, { text: e.target.value })}
                className="min-h-9 flex-1 resize-y rounded-[--radius-sm] border border-border-light bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <input
                type="text"
                inputMode="numeric"
                aria-label={`Points for item ${i + 1}`}
                value={d.rule_points !== null ? String(d.rule_points) : d.points}
                disabled={d.rule_points !== null}
                title={d.rule_points !== null ? "Set by the class rule" : undefined}
                onFocus={(e) => e.target.select()}
                onChange={(e) => set(i, { points: e.target.value })}
                className={numberInputClass}
              />
              <button
                type="button"
                onClick={() => onChange(drafts.filter((_, j) => j !== i))}
                disabled={drafts.length === 1}
                aria-label={`Remove item ${i + 1}`}
                className="min-h-9 min-w-9 rounded-[--radius-sm] text-text-muted hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
              >
                ×
              </button>
            </div>
            {d.rule_id && (
              <p className="mt-1 text-[11px] text-primary">
                Class rule{d.rule_text ? ` · ${d.rule_text}` : ""} ·{" "}
                <button
                  type="button"
                  onClick={() => set(i, { rule_id: null, rule_text: null, rule_points: null })}
                  className="font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Unlink
                </button>
              </p>
            )}
          </li>
        ))}
      </ul>
      {drafts.length < MAX_ITEMS && (
        <button
          type="button"
          onClick={() => onChange([...drafts, EMPTY_DRAFT])}
          className={linkButtonClass}
        >
          + Add an item
        </button>
      )}
      <SplitBar graph={graph} problem={problemPoints} />
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-9 rounded-[--radius-md] border border-border-light px-3 text-xs font-semibold text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(drafts)}
          disabled={busy || over}
          className="min-h-9 rounded-[--radius-md] bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save checklist"}
        </button>
      </div>
    </Section>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[11px] text-[color:var(--color-error)]">
      {error}
    </p>
  );
}

