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

  const reload = () => {
    setLoading(true);
    api.leads().then((d) => setLeads(d.leads)).finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    api.leads().then((d) => { if (!cancelled) { setLeads(d.leads); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await api.updateLeadStatus(leadId, newStatus);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
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
        <table>
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
                    onChange={(e) => handleStatusChange(lead.id, e.target.value)}
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
                    <div style={{ fontSize: 14 }}>Leads will appear here when schools submit the contact form.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
