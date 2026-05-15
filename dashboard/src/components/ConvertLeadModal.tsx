import { useState } from "react";
import { api, type ContactLeadData } from "../lib/api";
import { btnGhost, btnPrimary, inputStyle, overlay } from "../lib/styles";

/**
 * Convert a lead to a school. Creates the school, links the lead,
 * then (optionally) invites the contact as the first teacher.
 *
 * The lead is linked to the school *before* invite is attempted —
 * if the invite fails (bad email, etc.) the operator still has a
 * usable school + linked lead and can retry the invite manually.
 * The opposite order would leave an orphaned school if the invite
 * step threw.
 */
export default function ConvertLeadModal({
  lead,
  onClose,
  onConverted,
}: {
  lead: ContactLeadData;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [form, setForm] = useState({
    name: lead.school_name,
    contact_name: lead.contact_name,
    contact_email: lead.contact_email,
    notes: "",
  });
  const [sendInvite, setSendInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invite_url?: string; invite_error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const school = await api.createSchool({
        name: form.name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        notes: form.notes.trim() || undefined,
      });
      // Link the lead first so a failed invite doesn't leave the
      // school orphaned from the lead.
      await api.updateLead(lead.id, { status: "converted", school_id: school.id });

      let invite_url: string | undefined;
      let invite_error: string | undefined;
      if (sendInvite) {
        try {
          const res = await api.inviteTeacher(school.id, form.contact_email.trim());
          invite_url = res.invite_url;
        } catch (e) {
          invite_error = (e as Error).message;
        }
      }
      setResult({ invite_url, invite_error });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay} onClick={() => !submitting && (result ? onConverted() : onClose())}>
      <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#9989;</div>
            <h3 style={{ marginBottom: 4 }}>School created</h3>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
              <strong>{form.name}</strong> has been added to your schools.
            </p>
            {result.invite_url && (
              <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--ok-soft)", borderRadius: 3, border: "1px solid rgba(74, 107, 58, 0.3)", textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)", marginBottom: 6 }}>
                  Invite sent to {form.contact_email}
                </div>
                <code style={{ fontSize: 11, color: "var(--ink-soft)", display: "block", wordBreak: "break-all" }}>
                  {result.invite_url}
                </code>
              </div>
            )}
            {result.invite_error && (
              <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--warn-soft)", borderRadius: 3, border: "1px solid rgba(180, 110, 30, 0.3)", textAlign: "left", fontSize: 12.5 }}>
                <strong>Invite failed.</strong> The school was created and linked, but the teacher invite couldn't be sent: {result.invite_error}. You can retry from the school page.
              </div>
            )}
            <button onClick={onConverted} style={btnPrimary}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ marginBottom: 2 }}>Convert lead to school</h3>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Create a school and optionally invite the contact as the first teacher.
                </div>
              </div>
              <button onClick={onClose} style={btnGhost}>Cancel</button>
            </div>
            {error && (
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--danger-soft)", borderRadius: 3, border: "1px solid rgba(138, 35, 23, 0.3)", fontSize: 13, color: "var(--danger)" }}>
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="School name">
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Contact name">
                  <input type="text" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Contact email">
                  <input type="email" required value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} style={inputStyle} />
                </Field>
              </div>
              <Field label="Internal notes (optional)">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Deal context, pricing, etc."
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  Send teacher invite to {form.contact_email || "contact email"}
                </span>
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? "Creating…" : "Create school & convert"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const modalCard: React.CSSProperties = {
  maxWidth: 560,
  width: "90%",
  maxHeight: "85vh",
  overflow: "auto",
  background: "var(--surface)",
  border: "1px solid var(--rule-strong)",
  boxShadow: "0 16px 48px rgba(20, 19, 15, 0.18)",
};
