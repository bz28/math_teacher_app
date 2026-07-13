import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  type LeadDetail as LeadDetailData,
  type LeadMeeting,
  type LeadNote,
  type LeadSource,
  type LeadStatus,
  type MeetingType,
} from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { btnGhost, btnPrimary, btnSmall, inputStyle } from "../lib/styles";
import { Checkbox } from "../components/Checkbox";
import { EditorialModal } from "../components/EditorialModal";
import { useConfirm } from "../lib/confirm";
import { useToast } from "../lib/toast";
import { EditableText } from "../components/EditableText";
import ConvertLeadModal from "../components/ConvertLeadModal";

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

const SOURCE_LABEL: Record<LeadSource, string> = {
  inbound_form: "Inbound",
  warm_intro: "Warm intro",
  outbound: "Outbound",
  event: "Event",
};

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  // Scheduled meetings — default to "schedule it for later"
  { value: "demo", label: "Demo" },
  { value: "follow_up", label: "Follow-up" },
  { value: "onboarding", label: "Onboarding" },
  { value: "other", label: "Other meeting" },
  // Touchpoints — default to "log what just happened"
  { value: "email", label: "Email" },
  { value: "call", label: "Phone call" },
  { value: "dm", label: "DM" },
  { value: "text", label: "Text" },
  { value: "linkedin", label: "LinkedIn" },
];

const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  demo: "Demo",
  follow_up: "Follow-up",
  onboarding: "Onboarding",
  other: "Meeting",
  email: "Email",
  call: "Phone call",
  dm: "DM",
  text: "Text",
  linkedin: "LinkedIn",
};

const MEETING_TYPE_ICON: Record<MeetingType, string> = {
  demo: "🗓",
  follow_up: "🗓",
  onboarding: "🗓",
  other: "🗓",
  email: "✉️",
  call: "📞",
  dm: "💬",
  text: "💬",
  linkedin: "💼",
};

/** Touchpoints are after-the-fact contact logs. They default to
 *  "already happened" in the form and are visually distinct from
 *  scheduled meetings. The Meeting model carries them because the
 *  timeline + edit/delete UX is identical. */
const TOUCHPOINT_TYPES: MeetingType[] = ["email", "call", "dm", "text", "linkedin"];
const isTouchpoint = (t: MeetingType): boolean => TOUCHPOINT_TYPES.includes(t);

type MeetingState = "upcoming" | "past_unmarked" | "held" | "cancelled";

export default function LeadDetail() {
  const { leadId = "" } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState<LeadDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Modals
  const [showSchedule, setShowSchedule] = useState<{ initialType: MeetingType } | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<LeadMeeting | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [editingNote, setEditingNote] = useState<LeadNote | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const reload = async () => {
    try {
      const data = await api.lead(leadId);
      setLead(data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!leadId) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (loading) return <p className="loading">Loading…</p>;
  if (notFound || !lead) {
    return (
      <div>
        <BackLink onClick={() => navigate("/leads")} />
        <div className="empty-state" style={{ marginTop: 24 }}>
          <div className="empty-state-title">Lead not found</div>
        </div>
      </div>
    );
  }

  const handleStatusChange = async (s: LeadStatus) => {
    if (s === "converted") {
      setShowConvert(true);
      return;
    }
    try {
      await api.updateLead(lead.id, { status: s });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const handleApproxStudentsChange = async (n: number | null) => {
    try {
      await api.updateLead(lead.id, { approx_students: n });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!(await confirm({
      title: "Delete this lead?",
      message: <><strong>{lead.school_name}</strong> will be removed permanently, along with all its meetings and notes. This can't be undone.</>,
      confirmLabel: "Delete",
    }))) return;
    try {
      await api.deleteLead(lead.id);
      navigate("/leads");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div>
      <BackLink onClick={() => navigate("/leads")} />

      <Header
        lead={lead}
        onStatusChange={handleStatusChange}
        onApproxStudentsChange={handleApproxStudentsChange}
        onFieldSave={async (patch) => {
          await api.updateLead(lead.id, patch);
          reload();
        }}
        onConvert={() => setShowConvert(true)}
        onDelete={handleDelete}
      />

      {lead.source === "inbound_form" && lead.message && (
        <div className="table-card" style={{ marginBottom: 20, padding: 16, background: "var(--paper-2)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5, marginBottom: 6 }}>
            Original inbound message
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-soft)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {lead.message}
          </div>
        </div>
      )}

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ marginBottom: 0 }}>Activity</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowSchedule({ initialType: "demo" })} style={btnPrimary}>+ Schedule meeting</button>
            <button onClick={() => setShowSchedule({ initialType: "email" })} style={btnGhost}>+ Log contact</button>
            <button onClick={() => setShowAddNote(true)} style={btnGhost}>+ Add note</button>
          </div>
        </div>
        <Timeline
          lead={lead}
          onEditMeeting={(m) => setEditingMeeting(m)}
          onEditNote={(n) => setEditingNote(n)}
          onMarkHeld={async (m, outcome) => {
            await api.updateLeadMeeting(lead.id, m.id, {
              held_at: new Date().toISOString(),
              outcome: outcome || null,
            });
            reload();
          }}
          onCancel={async (m) => {
            await api.updateLeadMeeting(lead.id, m.id, {
              cancelled_at: new Date().toISOString(),
            });
            reload();
          }}
          onDeleteMeeting={async (m) => {
            if (!(await confirm({
              title: "Delete this meeting?",
              message: "This can't be undone.",
              confirmLabel: "Delete",
            }))) return;
            await api.deleteLeadMeeting(lead.id, m.id);
            reload();
          }}
          onDeleteNote={async (n) => {
            if (!(await confirm({
              title: "Delete this note?",
              message: "This can't be undone.",
              confirmLabel: "Delete",
            }))) return;
            await api.deleteLeadNote(lead.id, n.id);
            reload();
          }}
        />
      </div>

      {showSchedule && (
        <MeetingModal
          mode="create"
          initialType={showSchedule.initialType}
          onClose={() => setShowSchedule(null)}
          onSubmit={async (payload) => {
            await api.createLeadMeeting(lead.id, payload);
            setShowSchedule(null);
            reload();
          }}
        />
      )}
      {editingMeeting && (
        <MeetingModal
          mode="edit"
          meeting={editingMeeting}
          onClose={() => setEditingMeeting(null)}
          onSubmit={async (payload) => {
            await api.updateLeadMeeting(lead.id, editingMeeting.id, payload);
            setEditingMeeting(null);
            reload();
          }}
        />
      )}
      {showAddNote && (
        <NoteModal
          onClose={() => setShowAddNote(false)}
          onSubmit={async (body) => {
            await api.createLeadNote(lead.id, body);
            setShowAddNote(false);
            reload();
          }}
        />
      )}
      {editingNote && (
        <NoteModal
          initial={editingNote.body}
          onClose={() => setEditingNote(null)}
          onSubmit={async (body) => {
            await api.updateLeadNote(lead.id, editingNote.id, body);
            setEditingNote(null);
            reload();
          }}
        />
      )}
      {showConvert && (
        <ConvertLeadModal
          lead={lead}
          onClose={() => setShowConvert(false)}
          onConverted={() => {
            setShowConvert(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="link-btn" style={{ marginBottom: 16, fontSize: 13 }}>
      ← Back to leads
    </button>
  );
}

/* ── Header ─────────────────────────────────────────────────────── */

function Header({
  lead,
  onStatusChange,
  onApproxStudentsChange,
  onFieldSave,
  onConvert,
  onDelete,
}: {
  lead: LeadDetailData;
  onStatusChange: (s: LeadStatus) => void;
  onApproxStudentsChange: (n: number | null) => void;
  onFieldSave: (patch: { school_name?: string; contact_name?: string; contact_email?: string }) => Promise<void>;
  onConvert: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(lead.contact_email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const isConverted = lead.status === "converted" && lead.school_id;

  return (
    <div className="page-header">
      <span className="eyebrow">{SOURCE_LABEL[lead.source]} lead</span>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 6 }}>
            <EditableText
              value={lead.school_name}
              onSave={(school_name) => onFieldSave({ school_name })}
              inputStyle={{ fontSize: "inherit", fontWeight: "inherit", letterSpacing: "inherit" }}
            />
          </h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>
              <EditableText
                value={lead.contact_name}
                onSave={(contact_name) => onFieldSave({ contact_name })}
              />
            </span>
            <span style={{ color: "var(--muted-2)" }}>·</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              <EditableText
                value={lead.contact_email}
                inputType="email"
                onSave={(contact_email) => onFieldSave({ contact_email })}
              />
              <button onClick={handleCopy} style={{ ...btnSmall, marginLeft: 6, color: copied ? "var(--ok)" : "var(--accent)" }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
            <span style={{ color: "var(--muted-2)" }}>·</span>
            <span style={{ fontSize: 12.5, color: "var(--muted)", textTransform: "capitalize" }}>
              {lead.role}
            </span>
          </div>
          {lead.referred_by && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
              Referred by <strong style={{ color: "var(--ink-soft)" }}>{lead.referred_by}</strong>
            </div>
          )}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>Status</span>
              {isConverted ? (
                <span className="badge" style={STATUS_STYLES[lead.status]}>
                  {STATUS_OPTIONS.find((o) => o.value === lead.status)?.label}
                </span>
              ) : (
                <select
                  value={lead.status}
                  onChange={(e) => onStatusChange(e.target.value as LeadStatus)}
                  style={{
                    ...STATUS_STYLES[lead.status],
                    border: "1px solid var(--rule)",
                    borderRadius: 4,
                    padding: "3px 10px",
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
            </label>
            <ApproxStudentsCell value={lead.approx_students} onSave={onApproxStudentsChange} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {isConverted ? (
            <button onClick={() => navigate(`/schools/${lead.school_id}`)} style={btnPrimary}>
              View school →
            </button>
          ) : (
            <button onClick={onConvert} style={btnPrimary}>Convert to school</button>
          )}
          <button onClick={onDelete} style={{ ...btnGhost, color: "var(--danger)" }}>Delete lead</button>
        </div>
      </div>
    </div>
  );
}

function ApproxStudentsCell({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value?.toString() ?? "");

  const commit = () => {
    const trimmed = input.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setInput(value?.toString() ?? "");
      setEditing(false);
      return;
    }
    if (parsed !== value) onSave(parsed);
    setEditing(false);
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
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>
          Students
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: value !== null ? "var(--ink)" : "var(--muted-2)" }}>
          {value !== null ? value.toLocaleString() : "—"}
        </span>
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      min={0}
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { setInput(value?.toString() ?? ""); setEditing(false); }
      }}
      style={{ ...inputStyle, width: 100, padding: "4px 8px", fontSize: 13, fontFamily: "var(--font-mono)" }}
    />
  );
}

/* ── Timeline ───────────────────────────────────────────────────── */

function Timeline({
  lead,
  onEditMeeting,
  onEditNote,
  onMarkHeld,
  onCancel,
  onDeleteMeeting,
  onDeleteNote,
}: {
  lead: LeadDetailData;
  onEditMeeting: (m: LeadMeeting) => void;
  onEditNote: (n: LeadNote) => void;
  onMarkHeld: (m: LeadMeeting, outcome: string) => Promise<void>;
  onCancel: (m: LeadMeeting) => Promise<void>;
  onDeleteMeeting: (m: LeadMeeting) => Promise<void>;
  onDeleteNote: (n: LeadNote) => Promise<void>;
}) {
  const entries = useMemo(() => buildTimeline(lead), [lead]);

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No activity yet.</div>
        <div className="empty-state-sub">Schedule a meeting or jot down a note to get started.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {entries.map((entry) =>
        entry.kind === "meeting" ? (
          <MeetingCard
            key={`m-${entry.meeting.id}`}
            meeting={entry.meeting}
            onEdit={() => onEditMeeting(entry.meeting)}
            onMarkHeld={(outcome) => onMarkHeld(entry.meeting, outcome)}
            onCancel={() => onCancel(entry.meeting)}
            onDelete={() => onDeleteMeeting(entry.meeting)}
          />
        ) : entry.kind === "note" ? (
          <NoteCard
            key={`n-${entry.note.id}`}
            note={entry.note}
            onEdit={() => onEditNote(entry.note)}
            onDelete={() => onDeleteNote(entry.note)}
          />
        ) : (
          <SystemEntry key={`s-${entry.id}`} text={entry.text} at={entry.at} />
        ),
      )}
    </div>
  );
}

type TimelineEntry =
  | { kind: "meeting"; at: string; meeting: LeadMeeting }
  | { kind: "note"; at: string; note: LeadNote }
  | { kind: "system"; id: string; at: string; text: string };

function buildTimeline(lead: LeadDetailData): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const m of lead.meetings) {
    // Sort key = most recent meaningful timestamp on the meeting:
    // held > cancelled > scheduled. This puts a meeting where the
    // operator expects to see it (when it happened, not when it was
    // booked weeks ago).
    const at = m.held_at ?? m.cancelled_at ?? m.scheduled_at;
    entries.push({ kind: "meeting", at, meeting: m });
  }
  for (const n of lead.notes) {
    entries.push({ kind: "note", at: n.created_at, note: n });
  }
  entries.push({
    kind: "system",
    id: "created",
    at: lead.created_at,
    text: lead.referred_by
      ? `Lead created · ${SOURCE_LABEL[lead.source]} from ${lead.referred_by}`
      : `Lead created · ${SOURCE_LABEL[lead.source]}`,
  });
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function meetingState(m: LeadMeeting): MeetingState {
  if (m.cancelled_at) return "cancelled";
  if (m.held_at) return "held";
  if (new Date(m.scheduled_at).getTime() < Date.now()) return "past_unmarked";
  return "upcoming";
}

function MeetingCard({
  meeting,
  onEdit,
  onMarkHeld,
  onCancel,
  onDelete,
}: {
  meeting: LeadMeeting;
  onEdit: () => void;
  onMarkHeld: (outcome: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const state = meetingState(meeting);
  const [markingHeld, setMarkingHeld] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState("");

  const stateStyles: Record<MeetingState, { label: string; color: string }> = {
    upcoming: { label: "Upcoming", color: "var(--info)" },
    past_unmarked: { label: "Past · mark held?", color: "var(--accent)" },
    held: { label: "Held", color: "var(--ok)" },
    cancelled: { label: "Cancelled", color: "var(--muted-2)" },
  };

  const dt = new Date(meeting.scheduled_at);
  const dateLabel = dt.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--rule)",
        borderRadius: 4,
        background: "var(--surface)",
        opacity: state === "cancelled" ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>{MEETING_TYPE_ICON[meeting.type]}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
              {MEETING_TYPE_LABEL[meeting.type]}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5,
              color: stateStyles[state].color,
              padding: "2px 6px", borderRadius: 2, border: `1px solid ${stateStyles[state].color}`,
            }}>
              {stateStyles[state].label}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: meeting.agenda || meeting.outcome ? 6 : 0, textDecoration: state === "cancelled" ? "line-through" : "none" }}>
            {dateLabel}
          </div>
          {meeting.agenda && state !== "held" && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
              <span style={{ fontWeight: 600 }}>Agenda:</span> {meeting.agenda}
            </div>
          )}
          {meeting.outcome && (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--muted)" }}>Outcome:</span> {meeting.outcome}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} style={btnSmall}>Edit</button>
          {(state === "upcoming" || state === "past_unmarked") && (
            <button onClick={() => setMarkingHeld(true)} style={{ ...btnSmall, color: "var(--ok)" }}>
              Mark held
            </button>
          )}
          {(state === "upcoming" || state === "past_unmarked") && (
            <button onClick={onCancel} style={{ ...btnSmall, color: "var(--muted)" }}>
              Cancel
            </button>
          )}
          <button onClick={onDelete} style={{ ...btnSmall, color: "var(--danger)" }}>×</button>
        </div>
      </div>
      {markingHeld && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--rule)" }}>
          <textarea
            autoFocus
            placeholder="Outcome (what happened, next steps)"
            value={outcomeDraft}
            onChange={(e) => setOutcomeDraft(e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontSize: 13, resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => { setMarkingHeld(false); setOutcomeDraft(""); }}
              style={btnGhost}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                await onMarkHeld(outcomeDraft.trim());
                setMarkingHeld(false);
                setOutcomeDraft("");
              }}
              style={btnPrimary}
            >
              Save as held
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: LeadNote;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <div style={{ padding: 14, border: "1px solid var(--rule)", borderRadius: 4, background: "var(--paper-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>📝</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {note.created_by ?? "Admin"} · {formatRelativeDate(note.created_at)}
              {note.updated_at && " · edited"}
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-soft)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {note.body}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} style={btnSmall}>Edit</button>
          <button onClick={onDelete} style={{ ...btnSmall, color: "var(--danger)" }}>×</button>
        </div>
      </div>
    </div>
  );
}

function SystemEntry({ text, at }: { text: string; at: string }) {
  return (
    <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)", display: "flex", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 14 }}>✨</span>
      <span>{text}</span>
      <span style={{ color: "var(--muted-2)" }}>· {formatRelativeDate(at)}</span>
    </div>
  );
}

/* ── Meeting modal ──────────────────────────────────────────────── */

function MeetingModal({
  mode,
  meeting,
  initialType,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  meeting?: LeadMeeting;
  /** Seed the type select. "+ Schedule meeting" passes "demo"
   *  and the form defaults to a future scheduled_at; "+ Log contact"
   *  passes "email" and the form defaults to "already happened". */
  initialType?: MeetingType;
  onClose: () => void;
  onSubmit: (payload: {
    type: MeetingType;
    scheduled_at: string;
    agenda: string | null;
    held_at: string | null;
    outcome: string | null;
  }) => Promise<void>;
}) {
  const [type, setType] = useState<MeetingType>(
    meeting?.type ?? initialType ?? "demo",
  );
  const startsAsTouchpoint = isTouchpoint(type);
  const [scheduledAt, setScheduledAt] = useState(
    meeting
      ? toLocalInput(meeting.scheduled_at)
      // For touchpoints, default the timestamp to "right now" since
      // the operator is logging what just happened.
      : toLocalInput(startsAsTouchpoint ? new Date().toISOString() : defaultScheduledAt()),
  );
  const [agenda, setAgenda] = useState(meeting?.agenda ?? "");
  const [alreadyHappened, setAlreadyHappened] = useState(
    mode === "create" ? startsAsTouchpoint : meeting?.held_at != null,
  );
  const [outcome, setOutcome] = useState(meeting?.outcome ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const now = new Date();
      const isoSched = new Date(scheduledAt).toISOString();
      // Touchpoints created from the "Schedule meeting" modal inherit
      // its tomorrow-default. If the operator flipped the type dropdown
      // to a touchpoint without touching the date field, isoSched still
      // reads as tomorrow — clamp to now so we don't write a future-
      // dated touchpoint at creation time. Edit mode trusts the user's
      // explicit time choice (and dropping the clamp there avoids the
      // "I changed the time but the timeline still shows the old one"
      // bug, since held_at now tracks scheduled_at on every save).
      const effectiveScheduled =
        mode === "create" && isTouchpoint(type) && new Date(isoSched) > now
          ? now.toISOString()
          : isoSched;
      // Touchpoints are always after-the-fact by definition, so they
      // ALWAYS write held_at even when the user opened the modal as
      // a meeting and then switched the type dropdown (which hides
      // the checkbox but leaves alreadyHappened stuck at its initial
      // value). held_at tracks scheduled_at every save — the form has
      // no separate held_at field, so preserving an orphaned earlier
      // value just meant the timeline ignored the user's time edit.
      const effectiveHeld = isTouchpoint(type) || alreadyHappened;
      await onSubmit({
        type,
        scheduled_at: effectiveScheduled,
        agenda: agenda.trim() || null,
        held_at: effectiveHeld ? effectiveScheduled : null,
        outcome: effectiveHeld && outcome.trim() ? outcome.trim() : null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const touchpoint = isTouchpoint(type);
  const createTitle = touchpoint ? "Log contact" : "Schedule meeting";
  const editTitle = touchpoint ? "Edit contact" : "Edit meeting";
  const createSubtitle = touchpoint
    ? "Record an outreach touchpoint — email, call, DM, or other."
    : "Book a demo, follow-up, or onboarding call.";

  return (
    <EditorialModal
      eyebrow={touchpoint ? "Contact" : "Meeting"}
      title={mode === "create" ? createTitle : editTitle}
      subtitle={mode === "create" ? createSubtitle : undefined}
      onClose={() => !submitting && onClose()}
    >
      <form onSubmit={handleSubmit} style={{ padding: "22px 36px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div style={{ padding: "8px 12px", background: "var(--danger-soft)", borderRadius: 3, fontSize: 13, color: "var(--danger)" }}>
            {error}
          </div>
        )}
        <FormField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as MeetingType)} style={inputStyle}>
            {MEETING_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label={touchpoint ? "When" : "Date & time"}>
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={inputStyle}
          />
        </FormField>
        {!touchpoint && (
          <FormField label="Agenda (optional)">
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </FormField>
        )}
        {!touchpoint && (
          <Checkbox
            checked={alreadyHappened}
            onChange={setAlreadyHappened}
            label="This meeting already happened"
          />
        )}
        {alreadyHappened && (
          <FormField label="Outcome">
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="What happened, next steps"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </FormField>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Saving…" : mode === "create" ? "Schedule" : "Save"}
          </button>
        </div>
      </form>
    </EditorialModal>
  );
}

function defaultScheduledAt(): string {
  // Default to 1 day from now, on the hour — sensible "schedule something" baseline.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function toLocalInput(iso: string): string {
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time, not ISO.
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── Note modal ────────────────────────────────────────────────── */

function NoteModal({
  initial = "",
  onClose,
  onSubmit,
}: {
  initial?: string;
  onClose: () => void;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(body.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <EditorialModal
      eyebrow="Note"
      title={initial ? "Edit note" : "Add note"}
      onClose={() => !submitting && onClose()}
    >
      <form onSubmit={handleSubmit} style={{ padding: "20px 36px 28px" }}>
        {error && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--danger-soft)", borderRadius: 3, fontSize: 13, color: "var(--danger)" }}>
            {error}
          </div>
        )}
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Call notes, deal context, follow-up…"
          rows={6}
          style={{ ...inputStyle, fontSize: 13.5, resize: "vertical" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            style={{ ...btnPrimary, opacity: submitting || !body.trim() ? 0.6 : 1 }}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </EditorialModal>
  );
}

/* ── Shared bits ────────────────────────────────────────────── */

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
