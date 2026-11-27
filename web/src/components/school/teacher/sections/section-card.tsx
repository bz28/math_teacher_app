"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type TeacherSection, type TeacherSectionDetail } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BulkInviteForm } from "./bulk-invite-form";
import { SectionRoster } from "./section-roster";

export function SectionCard({
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
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  // Remove is one click away from a student vanishing from the roster, so
  // it confirms inline like Delete section / Revoke invite do. Only the
  // enrollment row is deleted server-side — submissions and grades stay —
  // which is why the confirm copy promises their work comes back on re-add.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
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
    if (!expanded) {
      // Closing the panel abandons any half-finished confirm — otherwise
      // it reopens already armed and one stray click fires the action.
      setConfirmingRegen(false);
      setConfirmingDelete(false);
      setConfirmingRevokeId(null);
      setConfirmingRemoveId(null);
      return;
    }
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

  const removeStudent = (studentId: string) =>
    run(async () => {
      await teacher.removeStudent(courseId, section.id, studentId);
      setConfirmingRemoveId(null);
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

  const toggleEnrollment = () =>
    run(async () => {
      await teacher.setEnrollmentOpen(courseId, section.id, !enrollmentOpen);
      // Detail wins over the list row when the roster is open, so refresh
      // it too or the card would snap back to the stale value.
      if (expanded) await reloadDetail();
      onChanged();
    }, "Failed to update enrollment");

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
  const enrollmentOpen = detail?.enrollment_open ?? section.enrollment_open;

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
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Share with your class
            </span>
            {!enrollmentOpen && (
              <span className="rounded-full bg-[color:var(--color-surface-alt-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-text-secondary">
                Closed
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => copyCode(code)}
              title="Click to copy"
              aria-label={copied ? "Copied join code" : `Copy join code ${code}`}
              className={`inline-flex items-center gap-2 rounded-[--radius-md] px-3 py-1.5 font-mono text-base font-bold tracking-[0.12em] transition-colors ${
                copied
                  ? "bg-[color:var(--color-success-light)] text-[color:var(--color-success)]"
                  : enrollmentOpen
                    ? "bg-primary-bg text-primary hover:bg-primary/20"
                    : "bg-[color:var(--color-surface-alt-2)] text-text-muted hover:bg-[color:var(--color-surface-alt-2)]/70"
              }`}
            >
              {code}
              <span className="font-sans text-[11px] font-semibold tracking-normal">
                {copied ? "Copied!" : "Copy"}
              </span>
            </button>
            <p className="text-xs text-text-muted">
              {enrollmentOpen
                ? "Students enter this code to join."
                : "New students can't join with this code right now."}
            </p>
            <button
              type="button"
              onClick={toggleEnrollment}
              disabled={busy}
              className="ml-auto rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
            >
              {enrollmentOpen ? "Close enrollment" : "Reopen enrollment"}
            </button>
          </div>
          {error && !expanded && (
            <p className="mt-2 text-xs text-[color:var(--color-error)]">{error}</p>
          )}
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
                <SectionRoster
                  courseId={courseId}
                  sectionId={section.id}
                  sectionName={section.name}
                  students={detail.students}
                  invites={detail.pending_invites}
                  busy={busy}
                  confirmingRemoveId={confirmingRemoveId}
                  setConfirmingRemoveId={setConfirmingRemoveId}
                  confirmingRevokeId={confirmingRevokeId}
                  setConfirmingRevokeId={setConfirmingRevokeId}
                  onRemove={removeStudent}
                  onResend={resendInvite}
                  onRevoke={revokeInvite}
                />
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
