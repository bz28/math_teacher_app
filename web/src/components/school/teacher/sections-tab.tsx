"use client";

import { useEffect, useState } from "react";
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
        <h2 className="text-lg font-bold text-text-primary">Class Sections</h2>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          + New Section
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

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
  const [studentEmail, setStudentEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

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

  const inviteStudent = () =>
    run(async () => {
      const email = studentEmail.trim();
      if (!email) return;
      if (!EMAIL_RE.test(email)) {
        setError("Please enter a valid email address");
        return;
      }
      const result = await teacher.inviteStudent(courseId, section.id, email);
      setStudentEmail("");
      setFlash(
        result.status === "enrolled"
          ? `Added ${email} — they already have an account.`
          : `Invite sent to ${email}. They'll appear in the roster once they accept.`,
      );
      setTimeout(() => setFlash(null), 4000);
      await reloadDetail();
      onChanged();
    }, "Failed to invite student");

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
          <h3 className="font-bold text-text-primary">{section.name}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {section.student_count} student{section.student_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {code && (
            <button
              onClick={() => copyCode(code)}
              title="Click to copy"
              className={`rounded-[--radius-pill] px-2 py-0.5 font-mono text-xs font-bold transition-colors ${
                copied
                  ? "bg-green-100 text-green-700 dark:bg-green-500/20"
                  : "bg-primary-bg text-primary hover:bg-primary/20"
              }`}
            >
              {copied ? "Copied!" : code}
            </button>
          )}
          <button
            onClick={onToggle}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
          >
            {expanded ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-light p-4">
          {loadingDetail && <p className="text-xs text-text-muted">Loading roster…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
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
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                    >
                      Cancel
                    </button>
                  </>
                ) : confirmingDelete ? (
                  <>
                    <span className="text-xs font-semibold text-red-700">
                      Delete &ldquo;{section.name}&rdquo;? Students will be unenrolled.
                    </span>
                    <button
                      onClick={deleteSection}
                      disabled={busy}
                      className="rounded-[--radius-sm] bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setConfirmingRegen(true)}
                      disabled={busy}
                      className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                    >
                      Regenerate join code
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      disabled={busy}
                      className="rounded-[--radius-sm] border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete section
                    </button>
                  </>
                )}
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Roster ({detail.students.length})
                </div>
                <div className="mt-2 space-y-1.5">
                  {detail.students.length === 0 && (
                    <p className="text-xs text-text-muted">No students enrolled yet.</p>
                  )}
                  {detail.students.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-[--radius-sm] bg-bg-subtle px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-semibold text-text-primary">{s.name}</div>
                        <div className="text-xs text-text-muted">{s.email}</div>
                      </div>
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-xs font-bold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {detail.pending_invites.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      Pending invites ({detail.pending_invites.length})
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {detail.pending_invites.map((i) => (
                        <div
                          key={i.id}
                          className="flex items-center justify-between rounded-[--radius-sm] border border-dashed border-border-light px-3 py-2 text-sm"
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
                                <span className="text-xs font-semibold text-red-700">Revoke?</span>
                                <button
                                  onClick={() => revokeInvite(i.id)}
                                  disabled={busy}
                                  className="text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
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
                                  className="text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
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

                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    inviteStudent();
                  }}
                >
                  <input
                    type="email"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    maxLength={255}
                    placeholder="student@email.com"
                    className="flex-1 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    Invite
                  </button>
                </form>
                {flash && <p className="mt-2 text-xs text-green-700">{flash}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
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
        <h2 className="text-lg font-bold text-text-primary">New Section</h2>
        <p className="mt-1 text-xs text-text-muted">e.g. &ldquo;Period 1&rdquo; or &ldquo;Block A&rdquo;</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={100}
          placeholder="Section name"
          className="mt-4 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
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
