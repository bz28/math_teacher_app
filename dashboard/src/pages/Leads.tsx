import { useEffect, useState } from "react";
import { api, type ContactLeadData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";

const STATUS_OPTIONS = ["new", "contacted", "converted", "declined"] as const;

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  new: { background: "#dbeafe", color: "#2563eb" },
  contacted: { background: "#fef3c7", color: "#b45309" },
  converted: { background: "#dcfce7", color: "#16a34a" },
  declined: { background: "#f1f5f9", color: "#94a3b8" },
};

export default function Leads() {
  const [leads, setLeads] = useState<ContactLeadData[]>([]);
  const [loading, setLoading] = useState(true);

  // Convert modal
  const [convertLead, setConvertLead] = useState<ContactLeadData | null>(null);
  const [convertForm, setConvertForm] = useState({ name: "", contact_name: "", contact_email: "", notes: "" });
  const [sendInvite, setSendInvite] = useState(true);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ invite_url?: string } | null>(null);

  // Copied feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.leads().then((d) => setLeads(d.leads)).finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    api.leads()
      .then((d) => { if (!cancelled) setLeads(d.leads); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleStatusChange = async (leadId: string, newStatus: string, lead: ContactLeadData) => {
    if (newStatus === "converted") {
      // Open convert modal with pre-filled data
      setConvertLead(lead);
      setConvertForm({
        name: lead.school_name,
        contact_name: lead.contact_name,
        contact_email: lead.contact_email,
        notes: "",
      });
      setSendInvite(true);
      setConvertResult(null);
      return;
    }
    try {
      await api.updateLeadStatus(leadId, newStatus);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertLead) return;
    setConverting(true);
    try {
      // 1. Create school
      const school = await api.createSchool({
        name: convertForm.name.trim(),
        contact_name: convertForm.contact_name.trim(),
        contact_email: convertForm.contact_email.trim(),
        notes: convertForm.notes.trim() || undefined,
      });

      // 2. Optionally send first invite
      let invite_url: string | undefined;
      if (sendInvite) {
        const res = await api.inviteTeacher(school.id, convertForm.contact_email.trim());
        invite_url = res.invite_url;
      }

      // 3. Update lead status
      await api.updateLeadStatus(convertLead.id, "converted");

      setConvertResult({ invite_url });
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setConverting(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (loading) return <p>Loading...</p>;

  const newCount = leads.filter((l) => l.status === "new").length;
  const contactedCount = leads.filter((l) => l.status === "contacted").length;
  const convertedCount = leads.filter((l) => l.status === "converted").length;

  return (
    <div>
      <h1>Leads</h1>

      <div className="stat-grid">
        <StatCard label="New" value={newCount} />
        <StatCard label="Contacted" value={contactedCount} />
        <StatCard label="Converted" value={convertedCount} />
        <StatCard label="Total" value={leads.length} />
      </div>

      <div className="table-card">
        <div className="table-scroll">
        <table>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>School</th>
              <th>Contact</th>
              <th>Role</th>
              <th>Students</th>
              <th>Message</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} style={{ opacity: lead.status === "declined" ? 0.55 : 1 }}>
                <td style={{ fontWeight: 600 }}>{lead.school_name}</td>
                <td>
                  <div style={{ fontSize: 13 }}>{lead.contact_name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{lead.contact_email}</div>
                </td>
                <td style={{ fontSize: 13, textTransform: "capitalize" }}>{lead.role}</td>
                <td style={{ fontSize: 13 }}>{lead.approx_students ?? "—"}</td>
                <td>
                  {lead.message ? (
                    <div style={{ fontSize: 12, color: "#475569", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lead.message}>
                      {lead.message}
                    </div>
                  ) : (
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>
                  <select
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value, lead)}
                    style={{
                      ...STATUS_STYLES[lead.status],
                      border: "1px solid #e2e8f0",
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      outline: "none",
                    }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </td>
                <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(lead.created_at)}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ color: "#94a3b8" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>No leads yet</div>
                    <div style={{ fontSize: 14 }}>Leads will appear here when schools submit the contact form on the /teachers page.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Convert modal */}
      {convertLead && (
        <div style={overlay} onClick={() => { if (!converting) { setConvertLead(null); setConvertResult(null); } }}>
          <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            {convertResult ? (
              // Success state
              <div style={{ textAlign: "center", padding: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>&#9989;</div>
                <h3 style={{ marginBottom: 4 }}>School Created!</h3>
                <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16 }}>
                  <strong>{convertForm.name}</strong> has been added to your schools.
                </p>
                {convertResult.invite_url && (
                  <div style={{ marginBottom: 16, padding: "12px 16px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0", textAlign: "left" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#16a34a", marginBottom: 6 }}>
                      Invite sent to {convertForm.contact_email}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ fontSize: 11, color: "#475569", flex: 1, wordBreak: "break-all" }}>
                        {convertResult.invite_url}
                      </code>
                      <button
                        onClick={() => handleCopy(convertResult.invite_url!, "convert-url")}
                        style={{ ...btnSmall, color: copiedId === "convert-url" ? "#16a34a" : "#6366f1" }}
                      >
                        {copiedId === "convert-url" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={() => { setConvertLead(null); setConvertResult(null); }} style={btnPrimary}>
                  Done
                </button>
              </div>
            ) : (
              // Form state
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ marginBottom: 2 }}>Convert Lead to School</h3>
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      Create a school and optionally invite the contact as the first teacher.
                    </div>
                  </div>
                  <button onClick={() => setConvertLead(null)} style={btnGhost}>Cancel</button>
                </div>
                <form onSubmit={handleConvert} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <FormField label="School Name">
                    <input
                      type="text"
                      value={convertForm.name}
                      onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                      required
                      style={inputStyle}
                    />
                  </FormField>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <FormField label="Contact Name">
                      <input
                        type="text"
                        value={convertForm.contact_name}
                        onChange={(e) => setConvertForm({ ...convertForm, contact_name: e.target.value })}
                        required
                        style={inputStyle}
                      />
                    </FormField>
                    <FormField label="Contact Email">
                      <input
                        type="email"
                        value={convertForm.contact_email}
                        onChange={(e) => setConvertForm({ ...convertForm, contact_email: e.target.value })}
                        required
                        style={inputStyle}
                      />
                    </FormField>
                  </div>
                  <FormField label="Internal Notes (optional)">
                    <textarea
                      value={convertForm.notes}
                      onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })}
                      placeholder="Deal context, pricing, etc."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </FormField>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={sendInvite}
                      onChange={(e) => setSendInvite(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "#6366f1" }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      Send teacher invite to {convertForm.contact_email || "contact email"}
                    </span>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                    <button type="button" onClick={() => setConvertLead(null)} style={btnGhost}>Cancel</button>
                    <button type="submit" disabled={converting} style={{ ...btnPrimary, opacity: converting ? 0.6 : 1 }}>
                      {converting ? "Creating..." : "Create School & Convert"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 24px",
  background: "#6366f1",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 14,
};

const btnGhost: React.CSSProperties = {
  padding: "6px 14px",
  background: "none",
  color: "#64748b",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #e2e8f0",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 600,
  color: "#6366f1",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const modalCard: React.CSSProperties = {
  maxWidth: 560,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};
