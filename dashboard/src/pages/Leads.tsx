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
import { btnGhost } from "../lib/styles";
import ConvertLeadModal from "../components/ConvertLeadModal";
import { EditorialModal } from "../components/EditorialModal";
import StatCard from "../components/StatCard";
import { useToast } from "../lib/toast";

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
  email: "Email",
  call: "Call",
  dm: "DM",
  text: "Text",
  linkedin: "LinkedIn",
};

const SOURCES_NEEDING_REFERRER: LeadSource[] = ["warm_intro", "outbound"];

// "Stale" = an active lead untouched for this long. Converted and
// declined leads don't age.
const STALE_DAYS = 5;
// Active = anything not yet terminal. Defined as the negation of
// converted/declined so any in-progress status (engaged, demo_held,
// and future ones) flows through Active automatically. Before this,
// demo_held silently dropped off the view.
const TERMINAL_STATUSES: LeadStatus[] = ["converted", "declined"];
const isActive = (lead: ContactLeadData): boolean =>
  !TERMINAL_STATUSES.includes(lead.status);

export default function Leads() {
  const navigate = useNavigate();
  const toast = useToast();
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
      toast((e as Error).message);
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
    if (filter === "active") return leads.filter(isActive);
    if (filter === "stale") return leads.filter(isStale);
    return leads;
  }, [leads, filter]);

  // Derive the Active count from isActive — same source of truth as
  // the table. The previous chip hardcoded new+contacted+engaged,
  // which silently dropped demo_held leads (their row was visible
  // but the chip count didn't reflect them, so the badge drifted
  // from the rendered list). Future non-terminal statuses now flow
  // through automatically.
  const filteredActiveCount = useMemo(
    () => leads.filter(isActive).length,
    [leads],
  );

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
          <button onClick={() => setShowAdd(true)} style={addLeadTrigger}>
            <span aria-hidden style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: 1, marginRight: 6 }}>+</span>
            Add lead
          </button>
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
                  ? `Active (${filteredActiveCount})`
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
  if (!isActive(lead)) return false;
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
    <EditorialModal
      eyebrow="Intake"
      title="Add lead"
      titleSize={32}
      subtitle="Log a warm intro, outbound prospect, or event contact. They won't be emailed."
      maxWidth={620}
      onClose={() => !submitting && onClose()}
    >
      {error && (
        <div style={{
          margin: "18px 36px 0", padding: "10px 14px",
          background: "var(--danger-soft)", borderLeft: "2px solid var(--danger)",
          fontSize: 13, color: "var(--danger)",
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ padding: "26px 36px 0" }}>
          <SectionHeader number="I." title="Contact" />
          <FormField label="School name">
            <input
              type="text"
              required
              value={form.school_name}
              onChange={(e) => setForm({ ...form, school_name: e.target.value })}
              style={fieldInput}
            />
          </FormField>
          <div style={fieldGridTwo}>
            <FormField label="Contact name">
              <input
                type="text"
                required
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                style={fieldInput}
              />
            </FormField>
            <FormField label="Contact email">
              <input
                type="email"
                required
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                style={fieldInput}
              />
            </FormField>
          </div>
          <FormField label="Role">
            <input
              type="text"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              style={fieldInput}
            />
          </FormField>

          <SectionHeader number="II." title="Context" />
          <FormField label="Source">
            <div role="radiogroup" aria-label="Source" style={sourceChipsRow}>
              {SOURCE_OPTIONS.map((o) => {
                const active = form.source === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setForm({ ...form, source: o.value })}
                    style={{
                      ...sourceChip,
                      ...(active ? sourceChipActive : {}),
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </FormField>
          {needsReferrer && (
            <FormField label="Referred by">
              <input
                type="text"
                value={form.referred_by}
                onChange={(e) => setForm({ ...form, referred_by: e.target.value })}
                placeholder="Who made the introduction"
                style={fieldInput}
              />
            </FormField>
          )}
          <FormField label="Approx students" hint="optional">
            <input
              type="number"
              min={0}
              value={form.approx_students}
              onChange={(e) => setForm({ ...form, approx_students: e.target.value })}
              style={fieldInput}
            />
          </FormField>
          <FormField label="Initial note" hint="optional">
            <textarea
              value={form.initial_note}
              onChange={(e) => setForm({ ...form, initial_note: e.target.value })}
              placeholder="How did this come up? Anything to remember."
              rows={3}
              style={{ ...fieldInput, resize: "vertical", lineHeight: 1.5 }}
            />
          </FormField>

          <div style={modalFooter}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              style={{ ...btnFile, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? "Filing…" : (
                <>
                  File lead <span aria-hidden style={{ marginLeft: 8, fontFamily: "var(--font-display)" }}>→</span>
                </>
              )}
            </button>
          </div>
      </form>
    </EditorialModal>
  );
}

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 10,
      marginTop: 6, marginBottom: 16,
      paddingBottom: 8, borderBottom: "1px solid var(--rule)",
    }}>
      <span style={{
        fontFamily: "var(--font-display)", fontStyle: "italic",
        fontSize: 18, color: "var(--accent)", letterSpacing: "-0.2px",
      }}>
        {number}
      </span>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "1.8px",
        color: "var(--ink-soft)",
      }}>
        {title}
      </span>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
      <label style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        color: "var(--muted)", letterSpacing: 1.6,
      }}>
        <span>{label}</span>
        {hint && (
          <span style={{
            fontFamily: "var(--font-display)", fontStyle: "italic",
            fontSize: 12, fontWeight: 400, textTransform: "none",
            letterSpacing: 0, color: "var(--muted-2)",
          }}>
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

const fieldInput: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 2,
  border: "1px solid var(--rule-strong)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const fieldGridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

const sourceChipsRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const sourceChip: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 110,
  padding: "9px 12px",
  border: "1px solid var(--rule-strong)",
  background: "var(--paper)",
  color: "var(--ink-soft)",
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
  fontWeight: 500,
  letterSpacing: 0.2,
  cursor: "pointer",
  borderRadius: 2,
  transition: "all 0.12s",
  textAlign: "center",
};

const sourceChipActive: React.CSSProperties = {
  background: "var(--ink)",
  color: "var(--paper)",
  borderColor: "var(--ink)",
  fontWeight: 600,
};

const modalFooter: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 10,
  marginTop: 24,
  marginLeft: -40,
  marginRight: -40,
  marginBottom: -0,
  padding: "18px 40px 26px",
  borderTop: "1px solid var(--rule)",
  background: "var(--paper-2)",
};

const addLeadTrigger: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 18px 10px",
  background: "var(--ink)",
  color: "var(--paper)",
  border: "none",
  borderRadius: 2,
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
  fontWeight: 600,
  letterSpacing: 0.5,
  cursor: "pointer",
  textTransform: "uppercase",
};

const btnFile: React.CSSProperties = {
  padding: "10px 22px",
  background: "var(--ink)",
  color: "var(--paper)",
  border: "none",
  borderRadius: 2,
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.4,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};
