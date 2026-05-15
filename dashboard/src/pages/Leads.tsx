import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ContactLeadData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { btnGhost, btnPrimary, btnSmall, inputStyle, overlay } from "../lib/styles";
import StatCard from "../components/StatCard";

const STATUS_OPTIONS = ["new", "contacted", "converted", "declined"] as const;

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  new: { background: "var(--info-soft)", color: "var(--info)" },
  contacted: { background: "var(--warn-soft)", color: "var(--warn)" },
  converted: { background: "var(--ok-soft)", color: "var(--ok)" },
  declined: { background: "transparent", color: "var(--muted-2)" },
};

// A lead in `new` or `contacted` for longer than this is "stale" and
// gets a visual flag — the operator's pre-attention surface for
// follow-up. Converted/declined leads don't age.
const STALE_DAYS = 5;

export default function Leads() {
  const [leads, setLeads] = useState<ContactLeadData[]>([]);
  const [loading, setLoading] = useState(true);

  // Convert modal
  const [convertLead, setConvertLead] = useState<ContactLeadData | null>(null);
  const [convertForm, setConvertForm] = useState({ name: "", contact_name: "", contact_email: "", notes: "" });
  const [sendInvite, setSendInvite] = useState(true);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ invite_url?: string } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

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
      setConvertLead(lead);
      setConvertForm({
        name: lead.school_name,
        contact_name: lead.contact_name,
        contact_email: lead.contact_email,
        notes: lead.notes ?? "",
      });
      setSendInvite(true);
      setConvertResult(null);
      setConvertError(null);
      return;
    }
    try {
      await api.updateLead(leadId, { status: newStatus });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Optimistic-then-confirm in-place edits. Mutates the row in state
  // before the server responds so the cell doesn't feel laggy; on
  // failure we reload to bring the truth back in.
  const handleSaveField = async (
    leadId: string,
    patch: { approx_students?: number | null; notes?: string | null },
  ) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, ...patch } : l)),
    );
    try {
      await api.updateLead(leadId, patch);
    } catch (e) {
      alert((e as Error).message);
      reload();
    }
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertLead) return;
    setConverting(true);
    setConvertError(null);
    try {
      const school = await api.createSchool({
        name: convertForm.name.trim(),
        contact_name: convertForm.contact_name.trim(),
        contact_email: convertForm.contact_email.trim(),
        notes: convertForm.notes.trim() || undefined,
      });
      let invite_url: string | undefined;
      if (sendInvite) {
        const res = await api.inviteTeacher(school.id, convertForm.contact_email.trim());
        invite_url = res.invite_url;
      }
      await api.updateLead(convertLead.id, { status: "converted", school_id: school.id });
      setConvertResult({ invite_url });
      reload();
    } catch (e) {
      setConvertError((e as Error).message);
    } finally {
      setConverting(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const navigate = useNavigate();
  const [filter, setFilter] = useState<"active" | "stale" | "all">("active");

  if (loading) return <p className="loading">Loading…</p>;

  const newCount = leads.filter((l) => l.status === "new").length;
  const contactedCount = leads.filter((l) => l.status === "contacted").length;
  const convertedCount = leads.filter((l) => l.status === "converted").length;
  const staleCount = leads.filter(isStale).length;

  const filteredLeads =
    filter === "active"
      ? leads.filter((l) => l.status === "new" || l.status === "contacted")
      : filter === "stale"
        ? leads.filter(isStale)
        : leads;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Pipeline</span>
        <h1>Leads</h1>
        <p>
          {newCount === 0 && contactedCount === 0
            ? leads.length === 0
              ? "Nothing inbound yet."
              : "Nothing active. All leads converted or declined."
            : `${newCount} new. ${contactedCount} contacted.${staleCount > 0 ? ` ${staleCount} stale.` : ""}`}
        </p>
      </div>

      <div className="stat-grid">
        <StatCard label="New" value={newCount} />
        <StatCard label="Contacted" value={contactedCount} />
        <StatCard
          label="Stale"
          value={staleCount}
          sub={`> ${STALE_DAYS}d untouched`}
        />
        <StatCard label="Converted" value={convertedCount} />
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>
            {filter === "active" ? "Active leads" : filter === "stale" ? "Stale leads" : "All leads"}
            <span style={{ fontWeight: 400, color: "var(--muted-2)", marginLeft: 8 }}>({filteredLeads.length})</span>
          </h3>
          <div style={{ display: "flex", gap: 0, background: "var(--paper-2)", borderRadius: 3, padding: 2, border: "1px solid var(--rule)" }}>
            {(["active", "stale", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "6px 14px", border: "none", borderRadius: 2, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "1.2px",
                  fontFamily: "var(--font-sans)",
                  background: filter === f ? "var(--surface)" : "transparent",
                  color: filter === f ? "var(--ink)" : "var(--muted)",
                }}
              >
                {f === "active"
                  ? `Active (${newCount + contactedCount})`
                  : f === "stale"
                    ? `Stale (${staleCount})`
                    : `All (${leads.length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
        <table>
          <colgroup>
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>School</th>
              <th>Contact</th>
              <th>Students</th>
              <th>Message</th>
              <th>Notes</th>
              <th>Status</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => {
              const stale = isStale(lead);
              return (
                <tr key={lead.id} style={{ opacity: lead.status === "declined" ? 0.55 : 1 }}>
                  <td>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--ink)" }}>
                      {lead.school_name}
                    </span>
                    <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "capitalize", marginTop: 2 }}>
                      {lead.role}
                    </div>
                    {lead.status === "converted" && lead.school_id && (
                      <div>
                        <button
                          onClick={() => navigate(`/schools/${lead.school_id}`)}
                          className="link-btn"
                          style={{ fontSize: 11 }}
                        >
                          View school &rarr;
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{lead.contact_name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{lead.contact_email}</div>
                  </td>
                  <td>
                    <EditableNumberCell
                      value={lead.approx_students}
                      onSave={(v) => handleSaveField(lead.id, { approx_students: v })}
                    />
                  </td>
                  <td>
                    {lead.message ? (
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lead.message}>
                        {lead.message}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <EditableTextCell
                      value={lead.notes}
                      placeholder="+ add note"
                      onSave={(v) => handleSaveField(lead.id, { notes: v })}
                    />
                  </td>
                  <td>
                    {lead.school_id ? (
                      <span className="badge" style={STATUS_STYLES[lead.status]} title="Linked to a school — delete the school to unlock">
                        {cap(lead.status)}
                      </span>
                    ) : (
                      <select
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value, lead)}
                        style={{
                          ...STATUS_STYLES[lead.status],
                          border: "1px solid var(--rule)",
                          borderRadius: 4,
                          padding: "3px 8px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{cap(s)}</option>
                        ))}
                      </select>
                    )}
                    {stale && (
                      <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span aria-hidden="true" className="dot dot-accent">●</span>
                        Stale {daysSince(stalenessAnchor(lead))}d
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11.5 }}>
                    <div style={{ color: "var(--ink-soft)" }}>
                      <span style={{ color: "var(--muted-2)" }}>received </span>
                      {formatRelativeDate(lead.created_at)}
                    </div>
                    {lead.updated_at && lead.updated_by && (
                      <div style={{ color: "var(--muted)", marginTop: 2 }}>
                        <span style={{ color: "var(--muted-2)" }}>updated </span>
                        {formatRelativeDate(lead.updated_at)} by {lead.updated_by}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredLeads.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    {filter === "active" && leads.length > 0 ? (
                      <>
                        <div className="empty-state-title">No active leads.</div>
                        <div className="empty-state-sub">
                          All leads converted or declined.{" "}
                          <button onClick={() => setFilter("all")} className="link-btn">
                            View all leads
                          </button>
                        </div>
                      </>
                    ) : filter === "stale" ? (
                      <>
                        <div className="empty-state-title">Nothing stale.</div>
                        <div className="empty-state-sub">
                          Every active lead has been touched in the last {STALE_DAYS} days.
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="empty-state-title">Nothing inbound yet.</div>
                        <div className="empty-state-sub">
                          Leads will appear when schools submit the contact form on the /demo page.
                        </div>
                      </>
                    )}
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
              <div style={{ textAlign: "center", padding: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>&#9989;</div>
                <h3 style={{ marginBottom: 4 }}>School created</h3>
                <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
                  <strong>{convertForm.name}</strong> has been added to your schools.
                </p>
                {convertResult.invite_url && (
                  <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--ok-soft)", borderRadius: 3, border: "1px solid rgba(74, 107, 58, 0.3)", textAlign: "left" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)", marginBottom: 6 }}>
                      Invite sent to {convertForm.contact_email}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ fontSize: 11, color: "var(--ink-soft)", flex: 1, wordBreak: "break-all" }}>
                        {convertResult.invite_url}
                      </code>
                      <button
                        onClick={() => handleCopy(convertResult.invite_url!, "convert-url")}
                        style={{ ...btnSmall, color: copiedId === "convert-url" ? "var(--ok)" : "var(--accent)" }}
                      >
                        {copiedId === "convert-url" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={() => { setConvertLead(null); setConvertResult(null); }} style={btnPrimary}>
                  Done
                </button>
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
                  <button onClick={() => { setConvertLead(null); setConvertError(null); }} style={btnGhost}>Cancel</button>
                </div>
                {convertError && (
                  <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--danger-soft)", borderRadius: 3, border: "1px solid rgba(138, 35, 23, 0.3)", fontSize: 13, color: "var(--danger)" }}>
                    {convertError}
                  </div>
                )}
                <form onSubmit={handleConvert} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <FormField label="School name">
                    <input
                      type="text"
                      value={convertForm.name}
                      onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
                      required
                      style={inputStyle}
                    />
                  </FormField>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <FormField label="Contact name">
                      <input
                        type="text"
                        value={convertForm.contact_name}
                        onChange={(e) => setConvertForm({ ...convertForm, contact_name: e.target.value })}
                        required
                        style={inputStyle}
                      />
                    </FormField>
                    <FormField label="Contact email">
                      <input
                        type="email"
                        value={convertForm.contact_email}
                        onChange={(e) => setConvertForm({ ...convertForm, contact_email: e.target.value })}
                        required
                        style={inputStyle}
                      />
                    </FormField>
                  </div>
                  <FormField label="Internal notes (optional)">
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
                      style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      Send teacher invite to {convertForm.contact_email || "contact email"}
                    </span>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                    <button type="button" onClick={() => setConvertLead(null)} style={btnGhost}>Cancel</button>
                    <button type="submit" disabled={converting} style={{ ...btnPrimary, opacity: converting ? 0.6 : 1 }}>
                      {converting ? "Creating…" : "Create school & convert"}
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

/* ── Helpers ───────────────────────────────────────────────────── */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Staleness anchor" — the most recent thing that should reset the
// timer. If the operator updated the lead (changed status, edited
// notes), we count from updated_at. Otherwise from created_at.
function stalenessAnchor(lead: ContactLeadData): string {
  return lead.updated_at ?? lead.created_at;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function isStale(lead: ContactLeadData): boolean {
  if (lead.status !== "new" && lead.status !== "contacted") return false;
  return daysSince(stalenessAnchor(lead)) > STALE_DAYS;
}

/* ── Inline-edit cells ─────────────────────────────────────────── */

function EditableNumberCell({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = input.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setInput(value?.toString() ?? "");
      setEditing(false);
      return;
    }
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setInput(value?.toString() ?? ""); setEditing(true); }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: value !== null ? "var(--ink)" : "var(--muted-2)",
        }}
      >
        {value !== null ? value.toLocaleString() : "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      inputMode="numeric"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { setInput(value?.toString() ?? ""); setEditing(false); }
      }}
      disabled={saving}
      style={{
        ...inputStyle,
        padding: "4px 8px",
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        width: 80,
      }}
    />
  );
}

function EditableTextCell({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string | null) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = input.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setInput(value ?? ""); setEditing(true); }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 12,
          color: value ? "var(--ink-soft)" : "var(--muted-2)",
          textAlign: "left",
          maxWidth: 240,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-sans)",
        }}
        title={value ?? "Click to add an internal note"}
      >
        {value ?? placeholder}
      </button>
    );
  }

  return (
    <textarea
      autoFocus
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Enter without shift saves; shift+enter adds a newline.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setInput(value ?? "");
          setEditing(false);
        }
      }}
      disabled={saving}
      rows={2}
      placeholder="Call notes, deal context, follow-up…"
      style={{
        ...inputStyle,
        fontSize: 12,
        padding: "4px 8px",
        resize: "vertical",
        width: "100%",
        minWidth: 200,
      }}
    />
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
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
  maxHeight: "80vh",
  overflow: "auto",
  background: "var(--surface)",
  border: "1px solid var(--rule-strong)",
  boxShadow: "0 16px 48px rgba(20, 19, 15, 0.18)",
};
