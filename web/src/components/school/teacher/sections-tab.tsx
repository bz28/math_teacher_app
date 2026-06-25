"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type TeacherSection, type TeacherSectionDetail } from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SectionsTab({ courseId, onChanged }: { courseId: string; onChanged: () => void }) {
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openRoster, setOpenRoster] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setSections((await teacher.sections(courseId)).sections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-text-primary">Class sections</h2>
        <button
          type="button"
          className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold tracking-[0.01em] text-white transition-colors hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          New section
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-[color:var(--color-error)]">{error}</p>}

      {!loading && sections.length === 0 ? (
        <EmptyState text="No sections yet. Add a class period to get started." />
      ) : (
        <div className="mt-4 space-y-3">
          {sections.map((s) => (
            <SectionCard
              key={s.id}
              courseId={courseId}
              section={s}
              expanded={openRoster === s.id}
              onToggle={() => setOpenRoster(openRoster === s.id ? null : s.id)}
              onDeleted={() => {
                setOpenRoster(null);
                reload();
                onChanged();
              }}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewSectionModal
          courseId={courseId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SectionCard({
  courseId,
  section,
  expanded,
  onToggle,
  onChanged,
  onDeleted,
}: {
  courseId: string;
  section: TeacherSection;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<TeacherSectionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasEditingNameRef = useRef(false);
  const { busy, error, setError, run } = useAsyncAction();

  useEffect(() => {
    if (wasEditingNameRef.current && !editingName) {
      renameTriggerRef.current?.focus();
    }
    wasEditingNameRef.current = editingName;
  }, [editingName]);

  useEffect(() => {
    if (!expanded) return;
    setLoadingDetail(true);
    teacher
      .section(courseId, section.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoadingDetail(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, courseId, section.id]);

  const reloadDetail = async () => {
    setDetail(await teacher.section(courseId, section.id));
  };

  const [flash, setFlash] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);

  const removeStudent = (studentId: string) =>
    run(async () => {
      await teacher.removeStudent(courseId, section.id, studentId);
      await reloadDetail();
      onChanged();
    }, "Failed to remove student");

  const resendInvite = (inviteId: string) =>
    run(async () => {
      await teacher.resendInvite(courseId, section.id, inviteId);
      setFlash("Invite email resent.");
      setTimeout(() => setFlash(null), 3000);
      await reloadDetail();
    }, "Failed to resend invite");

  const revokeInvite = (inviteId: string) =>
    run(async () => {
      await teacher.revokeInvite(courseId, section.id, inviteId);
      setConfirmingRevokeId(null);
      await reloadDetail();
    }, "Failed to revoke invite");

  const regenerateCode = () =>
    run(async () => {
      await teacher.generateJoinCode(courseId, section.id);
      setConfirmingRegen(false);
      await reloadDetail();
      onChanged();
    }, "Failed to regenerate join code");

  const deleteSection = () =>
    run(async () => {
      await teacher.deleteSection(courseId, section.id);
      setConfirmingDelete(false);
      onDeleted();
    }, "Failed to delete section");

  const startRename = () => {
    setEditingName(true);
    setNameDraft(section.name);
    setRenameError(null);
  };

  const cancelRename = () => {
    setEditingName(false);
    setRenameError(null);
  };

  const saveRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed.length > 200) {
      setRenameError("Name must be 1-200 characters");
      return;
    }
    if (trimmed === section.name) {
      cancelRename();
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await teacher.renameSection(courseId, section.id, trimmed);
      setEditingName(false);
      onChanged();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "Failed to rename section");
    } finally {
      setRenaming(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  const code = detail?.join_code ?? section.join_code;

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface">
      <div className="flex items-center justify-between p-4">
        <div>
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveRename();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                autoFocus
                disabled={renaming}
                maxLength={200}
                aria-label="Section name"
                aria-invalid={renameError ? true : undefined}
                aria-describedby={renameError ? `rename-error-${section.id}` : undefined}
                className="rounded-[--radius-md] border border-border-light bg-surface px-2 py-1 text-sm font-bold text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={renaming}
                className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelRename}
                disabled={renaming}
                className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <h3 className="font-bold text-text-primary">
              <button
                ref={renameTriggerRef}
                type="button"
                onClick={startRename}
                title="Click to rename"
                className="-mx-1 rounded px-1 hover:bg-[color:var(--color-surface-alt-2)]"
              >
                {section.name}
              </button>
            </h3>
          )}
          {renameError && (
            <p
              id={`rename-error-${section.id}`}
              role="alert"
              className="mt-1 text-xs text-[color:var(--color-error)]"
            >
              {renameError}
            </p>
          )}
          <p className="mt-0.5 text-xs text-text-muted">
            {section.student_count} student{section.student_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
          >
            {expanded ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      {/* Share-with-class block — always visible (no expand needed) so
          the join code, the teacher's core activation lever, is the
          dominant affordance. Bulk-email invites live under Manage. */}
      {code && (
        <div className="border-t border-border-light px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Share with your class
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => copyCode(code)}
              title="Click to copy"
              aria-label={copied ? "Copied join code" : `Copy join code ${code}`}
              className={`inline-flex items-center gap-2 rounded-[--radius-md] px-3 py-1.5 font-mono text-base font-bold tracking-[0.12em] transition-colors ${
                copied
                  ? "bg-[color:var(--color-success-light)] text-[color:var(--color-success)]"
                  : "bg-primary-bg text-primary hover:bg-primary/20"
              }`}
            >
              {code}
              <span className="font-sans text-[11px] font-semibold tracking-normal">
                {copied ? "Copied!" : "Copy"}
              </span>
            </button>
            <p className="text-xs text-text-muted">
              Students enter this code to join.
            </p>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border-light p-4">
          {loadingDetail && <p className="text-xs text-text-muted">Loading roster…</p>}
          {error && <p className="text-xs text-[color:var(--color-error)]">{error}</p>}
          {detail && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {confirmingRegen ? (
                  <>
                    <span className="text-xs font-semibold text-text-primary">Generate a new code? The old one stops working.</span>
                    <button
                      onClick={regenerateCode}
                      disabled={busy}
                      className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmingRegen(false)}
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : confirmingDelete ? (
                  <>
                    <span className="text-xs font-semibold text-[color:var(--color-error)]">
                      Delete &ldquo;{section.name}&rdquo;? Students will be unenrolled.
                    </span>
                    <button
                      onClick={deleteSection}
                      disabled={busy}
                      className="rounded-[--radius-sm] bg-[color:var(--color-error)] px-2.5 py-1 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85 disabled:opacity-50"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setConfirmingRegen(true)}
                      disabled={busy}
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
                    >
                      Regenerate join code
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      disabled={busy}
                      className="rounded-[--radius-sm] border border-[color:var(--color-error-border)] bg-white px-2.5 py-1 text-xs font-bold text-[color:var(--color-error)] hover:bg-[color:var(--color-error-light)] disabled:opacity-50"
                    >
                      Delete section
                    </button>
                  </>
                )}
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                  Roster ({detail.students.length})
                </div>
                <div className="mt-2 space-y-1.5">
                  {detail.students.length === 0 && (
                    <p className="text-xs text-text-muted">No students enrolled yet.</p>
                  )}
                  {detail.students.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-[--radius-sm] bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-semibold text-text-primary">{s.name}</div>
                        <div className="text-xs text-text-muted">{s.email}</div>
                      </div>
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-xs font-bold text-[color:var(--color-error)] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {detail.pending_invites.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                      Pending invites ({detail.pending_invites.length})
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {detail.pending_invites.map((i) => (
                        <div
                          key={i.id}
                          className="flex items-center justify-between rounded-[--radius-sm] border border-border-light px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-semibold text-text-primary">{i.email}</div>
                            <div className="text-xs text-text-muted">
                              Expires {new Date(i.expires_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {confirmingRevokeId === i.id ? (
                              <>
                                <span className="text-xs font-semibold text-[color:var(--color-error)]">Revoke?</span>
                                <button
                                  onClick={() => revokeInvite(i.id)}
                                  disabled={busy}
                                  className="text-xs font-bold text-[color:var(--color-error)] hover:underline disabled:opacity-50"
                                >
                                  Yes, revoke
                                </button>
                                <button
                                  onClick={() => setConfirmingRevokeId(null)}
                                  disabled={busy}
                                  className="text-xs font-semibold text-text-secondary hover:underline disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => resendInvite(i.id)}
                                  disabled={busy}
                                  className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                                >
                                  Resend
                                </button>
                                <button
                                  onClick={() => setConfirmingRevokeId(i.id)}
                                  disabled={busy}
                                  className="text-xs font-bold text-[color:var(--color-error)] hover:underline disabled:opacity-50"
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <BulkInviteForm
                  courseId={courseId}
                  sectionId={section.id}
                  busy={busy}
                  onInvited={async (msg) => {
                    setFlash(msg);
                    setTimeout(() => setFlash(null), 6000);
                    await reloadDetail();
                    onChanged();
                  }}
                />
                {flash && <p className="mt-2 text-xs text-[color:var(--color-success)]">{flash}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

function BulkInviteForm({
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

function NewSectionModal({
  courseId,
  onClose,
  onCreated,
}: {
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await teacher.createSection(courseId, name.trim());
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create section");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-sm rounded-[--radius-xl] bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-text-primary">New section</h2>
        <p className="mt-1 font-serif italic text-[14px] text-text-muted">e.g. &ldquo;Period 1&rdquo; or &ldquo;Block A&rdquo;</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={100}
          placeholder="Section name"
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-[color:var(--color-error)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
