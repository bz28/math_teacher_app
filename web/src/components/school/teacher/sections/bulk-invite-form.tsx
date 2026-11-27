"use client";

import { useState } from "react";
import { teacher } from "@/lib/api";
import { TOUR_IDS } from "@/components/tour";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Bulk invite form ──────────────────────────────────────────────────
//
// Real teachers roster 30 students at once. The old per-email field
// made them paste-then-click-paste-then-click. This form takes a
// blob of comma/newline-separated emails, validates, dedupes, and
// fans out the existing single-email endpoint in parallel — adding
// a backend endpoint is unnecessary when the wire shape stays one
// invite per email anyway.

interface BulkInviteOutcome {
  email: string;
  /** 'enrolled' / 'invited' / error message string. */
  status: string;
  ok: boolean;
}

const BULK_INVITE_LIMIT = 100;

export function BulkInviteForm({
  courseId,
  sectionId,
  busy: parentBusy,
  onInvited,
}: {
  courseId: string;
  sectionId: string;
  busy: boolean;
  onInvited: (summaryMessage: string) => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcomes, setOutcomes] = useState<BulkInviteOutcome[] | null>(null);

  const parsed = parseEmails(text);
  const overLimit = parsed.valid.length > BULK_INVITE_LIMIT;
  const disabled = submitting || parentBusy;

  const submit = async () => {
    setParseError(null);
    setOutcomes(null);
    if (parsed.invalid.length > 0) {
      setParseError(
        parsed.invalid.length === 1
          ? `"${parsed.invalid[0]}" doesn't look like an email address.`
          : `${parsed.invalid.length} entries don't look like email addresses.`,
      );
      return;
    }
    if (parsed.valid.length === 0) {
      setParseError("Paste one or more email addresses to invite.");
      return;
    }
    if (overLimit) {
      setParseError(
        `That's ${parsed.valid.length} emails — split into batches of ${BULK_INVITE_LIMIT} or fewer to avoid overloading the server.`,
      );
      return;
    }
    setSubmitting(true);
    // Fire all invites in parallel — for a 30-student roster this is
    // ~one round-trip total, vs 30 sequential round-trips.
    const results = await Promise.all(
      parsed.valid.map(async (email): Promise<BulkInviteOutcome> => {
        try {
          const r = await teacher.inviteStudent(courseId, sectionId, email);
          return { email, status: r.status, ok: true };
        } catch (e) {
          return {
            email,
            status: e instanceof Error ? e.message : "Failed",
            ok: false,
          };
        }
      }),
    );
    setSubmitting(false);
    setOutcomes(results);

    // On partial failure, keep just the failed addresses in the
    // textarea so the teacher can edit + retry without re-pasting
    // their whole roster. Fully-successful batches clear cleanly.
    const failed = results.filter((r) => !r.ok);
    setText(failed.length > 0 ? failed.map((r) => r.email).join("\n") : "");

    const enrolled = results.filter((r) => r.ok && r.status === "enrolled").length;
    const invited = results.filter((r) => r.ok && r.status === "invited").length;
    const parts: string[] = [];
    if (enrolled > 0) parts.push(`${enrolled} added`);
    if (invited > 0) parts.push(`${invited} invited`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);
    await onInvited(parts.join(" · "));
  };

  return (
    <div className="mt-4">
      <label
        htmlFor={`bulk-invite-${sectionId}`}
        className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]"
      >
        Invite students
      </label>
      <textarea
        id={`bulk-invite-${sectionId}`}
        data-tour-id={TOUR_IDS.teacherInvite}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParseError(null);
          setOutcomes(null);
        }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits, matching most other paste-and-go
          // forms in the product. Plain Enter inserts a newline (which
          // is the natural separator between emails).
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (!disabled && parsed.valid.length > 0 && !overLimit) submit();
          }
        }}
        rows={3}
        placeholder={`Paste emails — comma or newline separated. Cmd/Ctrl+Enter to send.`}
        className="mt-1 w-full resize-y rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-text-muted">
          {parsed.valid.length === 0 && parsed.invalid.length === 0 ? (
            `Up to ${BULK_INVITE_LIMIT} emails per batch.`
          ) : (
            <>
              <span
                className={`font-semibold ${overLimit ? "text-[color:var(--color-error)]" : "text-text-secondary"}`}
              >
                {parsed.valid.length}
              </span>{" "}
              valid
              {overLimit && (
                <>
                  {" · "}
                  <span className="font-semibold text-[color:var(--color-error)]">
                    over the {BULK_INVITE_LIMIT}-batch limit
                  </span>
                </>
              )}
              {parsed.invalid.length > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-[color:var(--color-error)]">
                    {parsed.invalid.length}
                  </span>{" "}
                  needs fixing
                </>
              )}
              {parsed.duplicates > 0 && (
                <>
                  {" · "}
                  <span className="text-text-muted">
                    {parsed.duplicates} duplicate{parsed.duplicates === 1 ? "" : "s"} dropped
                  </span>
                </>
              )}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || parsed.valid.length === 0 || overLimit}
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? "Sending…"
            : parsed.valid.length > 1
              ? `Invite ${parsed.valid.length}`
              : "Invite"}
        </button>
      </div>
      {/* Async result region — aria-live so screen readers announce
          parse errors AND post-submit failures without a focus jump.
          Empty when there's nothing to say so silence stays silence. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {parseError && <p className="mt-1.5 text-xs text-[color:var(--color-error)]">{parseError}</p>}
        {outcomes && outcomes.some((o) => !o.ok) && (
          <p className="mt-1.5 text-[11px] text-text-muted">
            {outcomes.filter((o) => !o.ok).length} couldn&rsquo;t be invited — kept in
            the box so you can fix and retry.
          </p>
        )}
      </div>
      {outcomes && outcomes.some((o) => !o.ok) && (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {outcomes
            .filter((o) => !o.ok)
            .map((o) => (
              <li key={o.email} className="text-[color:var(--color-error)]">
                <span className="font-semibold">{o.email}</span> — {o.status}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

interface ParsedEmails {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

function parseEmails(blob: string): ParsedEmails {
  const tokens = blob
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (EMAIL_RE.test(t)) {
      if (seen.has(lower)) {
        duplicates += 1;
        continue;
      }
      seen.add(lower);
      valid.push(t);
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid, duplicates };
}
