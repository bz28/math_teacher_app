import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type ContactLeadData,
  type LeadSource,
  type LeadStatus,
  type MeetingType,
} from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { btnGhost, btnPrimary, inputStyle, overlay } from "../lib/styles";
import StatCard from "../components/StatCard";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "engaged", label: "Engaged" },
  { value: "demo_held", label: "Demo held" },
  { value: "converted", label: "Converted" },
  { value: "declined", label: "Declined" },
];

const STATUS_STYLES: Record<LeadStatus, React.CSSProperties> = {
  new: { background: "var(--info-soft)", color: "var(--info)" },
  contacted: { background: "var(--warn-soft)", color: "var(--warn)" },
  engaged: { background: "var(--accent-soft)", color: "var(--accent)" },
  demo_held: { background: "var(--accent-soft)", color: "var(--accent)" },
  converted: { background: "var(--ok-soft)", color: "var(--ok)" },
  declined: { background: "transparent", color: "var(--muted-2)" },
};

const SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: "warm_intro", label: "Warm intro" },
  { value: "outbound", label: "Outbound" },
  { value: "event", label: "Event" },
  { value: "inbound_form", label: "Inbound" },
];

const SOURCE_LABEL: Record<LeadSource, string> = {
  inbound_form: "Inbound",
  warm_intro: "Warm intro",
  outbound: "Outbound",
  event: "Event",
};

const MEETING_LABEL: Record<MeetingType, string> = {
  demo: "Demo",
  follow_up: "Follow-up",
  onboarding: "Onboarding",
  other: "Meeting",
};

const SOURCES_NEEDING_REFERRER: LeadSource[] = ["warm_intro", "outbound"];

// "Stale" = an active lead (new/contacted/engaged) untouched for this
// long. Demo-held and converted leads don't age.
const STALE_DAYS = 5;
const ACTIVE_STATUSES: LeadStatus[] = ["new", "contacted", "engaged"];

export default function Leads() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<ContactLeadData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "stale" | "all">("active");
  const [showAdd, setShowAdd] = useState(false);
  const [convertLead, setConvertLead] = useState<ContactLeadData | null>(null);

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

  const handleStatusChange = async (lead: ContactLeadData, newStatus: LeadStatus) => {
    if (newStatus === "converted") {
      setConvertLead(lead);
      return;
    }
    try {
      await api.updateLead(lead.id, { status: newStatus });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const counts = useMemo(() => ({
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    engaged: leads.filter((l) => l.status === "engaged").length,
    demoHeld: leads.filter((l) => l.status === "demo_held").length,
    converted: leads.filter((l) => l.status === "converted").length,
    stale: leads.filter(isStale).length,
  }), [leads]);

  const filteredLeads = useMemo(() => {
    if (filter === "active") return leads.filter((l) => ACTIVE_STATUSES.includes(l.status));
    if (filter === "stale") return leads.filter(isStale);
    return leads;
  }, [leads, filter]);

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Pipeline</span>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div>
            <h1>Leads</h1>
            <p>{summaryLine(leads.length, counts)}</p>
          </div>
          <button onClick={() => setShowAdd(true)} style={btnPrimary}>+ Add lead</button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="New" value={counts.new} />
        <StatCard label="Engaged" value={counts.engaged} />
        <StatCard label="Demo held" value={counts.demoHeld} />
        <StatCard label="Converted" value={counts.converted} />
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
                  ? `Active (${counts.new + counts.contacted + counts.engaged})`
                  : f === "stale"
                    ? `Stale (${counts.stale})`
                    : `All (${leads.length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
        <table>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>School</th>
              <th>Contact</th>
              <th>Students</th>
              <th>Status</th>
              <th>Next action</th>
              <th>Last touch</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onOpen={() => navigate(`/leads/${lead.id}`)}
                onStatusChange={(s) => handleStatusChange(lead, s)}
              />
            ))}
            {filteredLeads.length === 0 && (
              <tr>
                <td colSpan={6}>
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
                          Leads will appear when schools submit the contact form, or when you{" "}
                          <button onClick={() => setShowAdd(true)} className="link-btn">+ Add lead</button>.
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

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onCreated={(newId) => {
            setShowAdd(false);
            navigate(`/leads/${newId}`);
          }}
        />
      )}

      {convertLead && (
        <ConvertLeadModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
          onConverted={() => {
            setConvertLead(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function summaryLine(
  total: number,
  counts: { new: number; engaged: number; demoHeld: number; stale: number },
): string {
  if (total === 0) return "Nothing inbound yet.";
  const parts: string[] = [];
  if (counts.new) parts.push(`${counts.new} new`);
  if (counts.engaged) parts.push(`${counts.engaged} engaged`);
  if (counts.demoHeld) parts.push(`${counts.demoHeld} demo held`);
  if (counts.stale) parts.push(`${counts.stale} stale`);
  return parts.length === 0 ? "All leads converted or declined." : parts.join(" · ") + ".";
}

/* ── Row ─────────────────────────────────────────────────────── */

function LeadRow({
  lead,
  onOpen,
  onStatusChange,
}: {
  lead: ContactLeadData;
  onOpen: () => void;
  onStatusChange: (s: LeadStatus) => void;
}) {
  const stale = isStale(lead);
  const rowStyle: React.CSSProperties = {
    cursor: "pointer",
    opacity: lead.status === "declined" ? 0.55 : 1,
  };
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <tr style={rowStyle} onClick={onOpen}>
      <td>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--ink)" }}>
          {lead.school_name}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <SourceChip source={lead.source} />
          <span style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "capitalize" }}>
            {lead.role}
          </span>
        </div>
      </td>
      <td>
        <div style={{ fontSize: 13 }}>{lead.contact_name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{lead.contact_email}</div>
      </td>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: lead.approx_students !== null ? "var(--ink)" : "var(--muted-2)" }}>
        {lead.approx_students !== null ? lead.approx_students.toLocaleString() : "—"}
      </td>
      <td onClick={stopPropagation}>
        {lead.school_id ? (
          <span className="badge" style={STATUS_STYLES[lead.status]} title="Linked to a school">
            {statusLabel(lead.status)}
          </span>
        ) : (
          <select
            value={lead.status}
            onChange={(e) => onStatusChange(e.target.value as LeadStatus)}
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
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
        {stale && (
          <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span aria-hidden="true" className="dot dot-accent">●</span>
            Stale {daysSince(lead.last_touch_at)}d
          </div>
        )}
      </td>
      <td>
        {lead.next_meeting_at && lead.next_meeting_type ? (
          <NextActionCell at={lead.next_meeting_at} type={lead.next_meeting_type} />
        ) : (
          <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>
        )}
      </td>
      <td style={{ fontSize: 12 }}>
        <div style={{ color: "var(--ink-soft)" }}>
          <span style={{ color: "var(--muted-2)" }}>{lastTouchLabel(lead.last_touch_kind)} </span>
          {formatRelativeDate(lead.last_touch_at)}
        </div>
      </td>
    </tr>
  );
}

function NextActionCell({ at, type }: { at: string; type: MeetingType }) {
  const dt = new Date(at);
  const isPast = isInPast(at);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: isPast ? "var(--accent)" : "var(--ink)" }}>
        {MEETING_LABEL[type]} · {dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
      </span>
      <span style={{ fontSize: 11, color: isPast ? "var(--accent)" : "var(--muted)" }}>
        {isPast
          ? `${daysSince(at)}d ago · mark held?`
          : dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </span>
    </div>
  );
}

function SourceChip({ source }: { source: LeadSource }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 2,
        border: "1px solid var(--rule)",
        color: "var(--muted)",
        background: "var(--paper-2)",
      }}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function statusLabel(status: LeadStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function lastTouchLabel(kind: ContactLeadData["last_touch_kind"]): string {
  if (kind === "meeting") return "met";
  if (kind === "note") return "note";
  return "created";
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function isInPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function isStale(lead: ContactLeadData): boolean {
  if (!ACTIVE_STATUSES.includes(lead.status)) return false;
  return daysSince(lead.last_touch_at) > STALE_DAYS;
}

/* ── Add lead modal ─────────────────────────────────────────────── */

function AddLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    school_name: "",
    contact_name: "",
    contact_email: "",
    role: "teacher",
    source: "warm_intro" as LeadSource,
    referred_by: "",
    approx_students: "",
    initial_note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReferrer = SOURCES_NEEDING_REFERRER.includes(form.source);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const approx = form.approx_students.trim() ? Number(form.approx_students) : null;
      const res = await api.createLead({
        school_name: form.school_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        role: form.role.trim() || "teacher",
        source: form.source,
        referred_by: needsReferrer && form.referred_by.trim() ? form.referred_by.trim() : null,
        approx_students: approx !== null && Number.isFinite(approx) && approx >= 0 ? approx : null,
        initial_note: form.initial_note.trim() || null,
      });
      onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay} onClick={() => !submitting && onClose()}>
      <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Add lead</h3>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              Log a warm intro, outbound prospect, or event contact.
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
          <FormField label="School name">
            <input
              type="text"
              required
              value={form.school_name}
              onChange={(e) => setForm({ ...form, school_name: e.target.value })}
              style={inputStyle}
            />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <FormField label="Contact name">
              <input
                type="text"
                required
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Contact email">
              <input
                type="email"
                required
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                style={inputStyle}
              />
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <FormField label="Source">
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as LeadSource })}
                style={inputStyle}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Role">
              <input
                type="text"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                style={inputStyle}
              />
            </FormField>
          </div>
          {needsReferrer && (
            <FormField label="Referred by">
              <input
                type="text"
                value={form.referred_by}
                onChange={(e) => setForm({ ...form, referred_by: e.target.value })}
                placeholder="Who made the introduction"
                style={inputStyle}
              />
            </FormField>
          )}
          <FormField label="Approx students (optional)">
            <input
              type="number"
              min={0}
              value={form.approx_students}
              onChange={(e) => setForm({ ...form, approx_students: e.target.value })}
              style={inputStyle}
            />
          </FormField>
          <FormField label="Initial note (optional)">
            <textarea
              value={form.initial_note}
              onChange={(e) => setForm({ ...form, initial_note: e.target.value })}
              placeholder="How did this come up? Anything to remember."
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </FormField>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Creating…" : "Create lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Convert lead modal ───────────────────────────────────────── */

function ConvertLeadModal({
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
  const [result, setResult] = useState<{ invite_url?: string } | null>(null);

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
      let invite_url: string | undefined;
      if (sendInvite) {
        const res = await api.inviteTeacher(school.id, form.contact_email.trim());
        invite_url = res.invite_url;
      }
      await api.updateLead(lead.id, { status: "converted", school_id: school.id });
      setResult({ invite_url });
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
              <FormField label="School name">
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
              </FormField>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <FormField label="Contact name">
                  <input type="text" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} style={inputStyle} />
                </FormField>
                <FormField label="Contact email">
                  <input type="email" required value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} style={inputStyle} />
                </FormField>
              </div>
              <FormField label="Internal notes (optional)">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Deal context, pricing, etc." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </FormField>
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
  maxHeight: "85vh",
  overflow: "auto",
  background: "var(--surface)",
  border: "1px solid var(--rule-strong)",
  boxShadow: "0 16px 48px rgba(20, 19, 15, 0.18)",
};
