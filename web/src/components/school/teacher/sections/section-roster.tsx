import type { TeacherSectionDetail } from "@/lib/api";

/** A section's roster under Manage: its students (each removable, with
 *  an inline confirm) and its pending email invites (resend / revoke).
 *  The confirms' state lives in the section card, which drops them when
 *  the panel closes. */
export function SectionRoster({
  sectionName,
  students,
  invites,
  busy,
  confirmingRemoveId,
  setConfirmingRemoveId,
  confirmingRevokeId,
  setConfirmingRevokeId,
  onRemove,
  onResend,
  onRevoke,
}: {
  sectionName: string;
  students: TeacherSectionDetail["students"];
  invites: TeacherSectionDetail["pending_invites"];
  busy: boolean;
  confirmingRemoveId: string | null;
  setConfirmingRemoveId: (id: string | null) => void;
  confirmingRevokeId: string | null;
  setConfirmingRevokeId: (id: string | null) => void;
  onRemove: (studentId: string) => void;
  onResend: (inviteId: string) => void;
  onRevoke: (inviteId: string) => void;
}) {
  return (
    <>
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
      Roster ({students.length})
    </div>
    <div className="mt-2 space-y-1.5">
      {students.length === 0 && (
        <p className="text-xs text-text-muted">No students enrolled yet.</p>
      )}
      {students.map((s) =>
        confirmingRemoveId === s.id ? (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[--radius-sm] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="font-semibold text-text-primary">
                Remove {s.name} from {sectionName}?
              </div>
              <div className="text-xs text-text-secondary">
                Their submitted work is kept and comes back if you re-add them.
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => onRemove(s.id)}
                disabled={busy}
                className="rounded-[--radius-sm] bg-[color:var(--color-error)] px-2.5 py-1 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85 disabled:opacity-50"
              >
                Yes, remove
              </button>
              <button
                onClick={() => setConfirmingRemoveId(null)}
                disabled={busy}
                autoFocus
                className="rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-[--radius-sm] bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-sm"
          >
            <div>
              <div className="font-semibold text-text-primary">{s.name}</div>
              <div className="text-xs text-text-muted">{s.email}</div>
            </div>
            <button
              onClick={() => setConfirmingRemoveId(s.id)}
              disabled={busy}
              className="text-xs font-bold text-[color:var(--color-error)] hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ),
      )}
    </div>

    {invites.length > 0 && (
      <div className="mt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Pending invites ({invites.length})
        </div>
        <div className="mt-2 space-y-1.5">
          {invites.map((i) => (
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
                      onClick={() => onRevoke(i.id)}
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
                      onClick={() => onResend(i.id)}
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

    </>
  );
}
