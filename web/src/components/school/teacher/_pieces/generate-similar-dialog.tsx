"use client";

import { useState } from "react";
import { teacher, type BankJob } from "@/lib/api";

/**
 * Small dialog: pick how many variations + optional constraint, then
 * schedule the generate-similar job. Children land in the pending
 * queue with parent_question_id set so they nest under their parent
 * once approved.
 */
export function GenerateSimilarDialog({
  itemId,
  onClose,
  onStarted,
}: {
  itemId: string;
  onClose: () => void;
  onStarted: (job: BankJob) => void;
}) {
  const [count, setCount] = useState(5);
  const [constraint, setConstraint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await teacher.generateSimilarBank(itemId, {
        count,
        constraint: constraint.trim() || null,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 className="text-base font-bold text-text-primary">✨ Make similar</h3>
        <p className="mt-1 text-xs text-text-muted">
          Generate variations of this question. They&rsquo;ll land in your
          Pending queue for review.
        </p>

        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-text-muted">
          How many?
        </label>
        <div className="mt-1 flex gap-1">
          {[1, 3, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={`rounded-[--radius-pill] px-3 py-1 text-xs font-bold transition-colors ${
                count === n
                  ? "bg-primary text-white"
                  : "border border-border-light text-text-secondary hover:bg-bg-subtle"
              }`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setCount(Math.max(1, Math.min(20, n)));
            }}
            aria-label="Custom quantity"
            className="w-14 rounded-[--radius-pill] border border-border-light bg-bg-base px-2 py-1 text-center text-xs font-bold text-text-primary focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>

        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-text-muted">
          Optional constraint
        </label>
        <textarea
          value={constraint}
          onChange={(e) => setConstraint(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder='e.g. "use friendlier numbers" or "make them word problems"'
          className="mt-1 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Starting…" : "✨ Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}
