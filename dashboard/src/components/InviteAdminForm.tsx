import { useState } from "react";
import { api } from "../lib/api";

/**
 * Inline invite-admin form. Toggled by a "+ Invite admin" button
 * on whichever page hosts it. On success, shows a brief banner
 * with the invited email and calls `onInvited()` so the parent
 * can reload its list.
 */
export function InviteAdminForm({ onInvited }: { onInvited?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.inviteAdmin(email.trim(), name.trim());
      setSuccess(email.trim());
      setName("");
      setEmail("");
      setOpen(false);
      onInvited?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {!open && (
          <button
            onClick={() => { setOpen(true); setSuccess(null); }}
            className="btn-primary"
          >
            + Invite admin
          </button>
        )}
      </div>

      {success && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", background: "var(--ok-soft)",
          borderRadius: 4, border: "1px solid rgba(74, 107, 58, 0.3)",
          fontSize: 13, color: "var(--ok)",
        }}>
          Invite sent to <strong>{success}</strong>. They&apos;ll receive an email with a link to set their password.
        </div>
      )}

      {open && (
        <div className="table-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h3 style={{ marginBottom: 0 }}>Invite new admin</h3>
            <button
              onClick={() => { setOpen(false); setError(null); }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            They&apos;ll receive an email with a link to set their password.
          </p>
          {error && (
            <div style={{
              marginBottom: 12, padding: "8px 12px", background: "var(--danger-soft)",
              borderRadius: 4, border: "1px solid rgba(138, 35, 23, 0.3)",
              fontSize: 13, color: "var(--danger)",
            }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="field-label">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                className="input"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="field-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@veradicai.com"
                required
                className="input"
              />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
