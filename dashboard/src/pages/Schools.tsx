import { useEffect, useState } from "react";
import { api, type SchoolListItem, type SchoolDetail } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";

export default function Schools() {
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
  const [creating, setCreating] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  // Copied feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.schools().then((d) => setSchools(d.schools)).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createSchool({
        name: createForm.name.trim(),
        contact_name: createForm.contact_name.trim(),
        contact_email: createForm.contact_email.trim(),
        city: createForm.city.trim() || undefined,
        state: createForm.state.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      });
      setCreateForm({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
      setShowCreate(false);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleViewDetail = async (schoolId: string) => {
    setLoadingDetail(true);
    setDetail(null);
    setInviteEmail("");
    setInviteResult(null);
    try {
      const data = await api.school(schoolId);
      setDetail(data);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleToggleActive = async (school: SchoolListItem) => {
    const action = school.is_active ? "Deactivate" : "Activate";
    if (!confirm(`${action} "${school.name}"? ${school.is_active ? "All teachers and students will lose access." : ""}`)) return;
    try {
      await api.updateSchool(school.id, { is_active: !school.is_active });
      reload();
      if (detail?.id === school.id) handleViewDetail(school.id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await api.inviteTeacher(detail.id, inviteEmail.trim());
      setInviteResult(res.invite_url);
      setInviteEmail("");
      handleViewDetail(detail.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!detail || !confirm("Cancel this invite?")) return;
    try {
      await api.cancelInvite(detail.id, inviteId);
      handleViewDetail(detail.id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (loading) return <p>Loading...</p>;

  const totalSchools = schools.length;
  const activeSchools = schools.filter((s) => s.is_active).length;
  const totalTeachers = schools.reduce((sum, s) => sum + s.teacher_count, 0);
  const totalStudents = schools.reduce((sum, s) => sum + s.student_count, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ marginBottom: 0 }}>Schools</h1>
        {!showCreate && (
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>
            + Add School
          </button>
        )}
      </div>

      <div className="stat-grid">
        <StatCard label="Total Schools" value={totalSchools} />
        <StatCard label="Active" value={activeSchools} />
        <StatCard label="Teachers" value={totalTeachers} />
        <StatCard label="Students" value={totalStudents} />
      </div>

      {/* ── Create form ─────────────────────────────────────────── */}
      {showCreate && (
        <div className="table-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ marginBottom: 0 }}>Add New School</h3>
            <button onClick={() => setShowCreate(false)} style={btnGhost}>Cancel</button>
          </div>
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField label="School Name">
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Lincoln High School"
                required
                style={inputStyle}
              />
            </FormField>
            <FormField label="Contact Name">
              <input
                type="text"
                value={createForm.contact_name}
                onChange={(e) => setCreateForm({ ...createForm, contact_name: e.target.value })}
                placeholder="Jane Smith"
                required
                style={inputStyle}
              />
            </FormField>
            <FormField label="Contact Email">
              <input
                type="email"
                value={createForm.contact_email}
                onChange={(e) => setCreateForm({ ...createForm, contact_email: e.target.value })}
                placeholder="jsmith@school.edu"
                required
                style={inputStyle}
              />
            </FormField>
            <div style={{ display: "flex", gap: 12 }}>
              <FormField label="City">
                <input
                  type="text"
                  value={createForm.city}
                  onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                  placeholder="San Francisco"
                  style={inputStyle}
                />
              </FormField>
              <FormField label="State">
                <input
                  type="text"
                  value={createForm.state}
                  onChange={(e) => setCreateForm({ ...createForm, state: e.target.value })}
                  placeholder="CA"
                  style={{ ...inputStyle, maxWidth: 80 }}
                />
              </FormField>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <FormField label="Internal Notes (optional)">
                <textarea
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                  placeholder="Deal context, pricing, etc."
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </FormField>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={creating} style={{ ...btnPrimary, opacity: creating ? 0.6 : 1 }}>
                {creating ? "Creating..." : "Add School"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Schools table ───────────────────────────────────────── */}
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Contact</th>
              <th>Teachers</th>
              <th>Students</th>
              <th>Status</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                <td>
                  <div>
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    {(s.city || s.state) && (
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        {[s.city, s.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>{s.contact_name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{s.contact_email}</div>
                </td>
                <td style={{ fontWeight: 600 }}>{s.teacher_count}</td>
                <td style={{ fontWeight: 600 }}>{s.student_count}</td>
                <td>
                  <span className="badge" style={
                    s.is_active
                      ? { background: "#dcfce7", color: "#16a34a" }
                      : { background: "#fef2f2", color: "#dc2626" }
                  }>
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(s.created_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => handleViewDetail(s.id)} style={btnSmall}>View</button>
                    <button
                      onClick={() => handleToggleActive(s)}
                      style={{ ...btnSmall, color: s.is_active ? "#ef4444" : "#16a34a" }}
                    >
                      {s.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {schools.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ color: "#94a3b8" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>No schools yet</div>
                    <div style={{ fontSize: 14 }}>Click "+ Add School" when you close your first deal.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── School detail modal ─────────────────────────────────── */}
      {(detail || loadingDetail) && (
        <div style={overlay} onClick={() => { setDetail(null); setInviteResult(null); }}>
          <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <p style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading...</p>
            ) : detail && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                  <div>
                    <h2 style={{ marginBottom: 4 }}>{detail.name}</h2>
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      {detail.contact_name} · {detail.contact_email}
                      {(detail.city || detail.state) && ` · ${[detail.city, detail.state].filter(Boolean).join(", ")}`}
                    </div>
                    {detail.notes && (
                      <div style={{ marginTop: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, fontSize: 13, color: "#475569" }}>
                        {detail.notes}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setDetail(null); setInviteResult(null); }} style={btnGhost}>Close</button>
                </div>

                {/* Teachers */}
                <div style={{ marginBottom: 24 }}>
                  <h3 style={{ marginBottom: 12 }}>
                    Teachers
                    <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>({detail.teachers.length})</span>
                  </h3>
                  {detail.teachers.length > 0 ? (
                    <table>
                      <thead>
                        <tr><th>Name</th><th>Email</th><th>Joined</th></tr>
                      </thead>
                      <tbody>
                        {detail.teachers.map((t) => (
                          <tr key={t.id}>
                            <td style={{ fontWeight: 500 }}>{t.name || "—"}</td>
                            <td style={{ fontSize: 13, color: "#64748b" }}>{t.email}</td>
                            <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(t.joined_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: "#94a3b8", fontSize: 13 }}>No teachers yet. Send an invite below.</p>
                  )}
                </div>

                {/* Pending Invites */}
                {detail.pending_invites.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h3 style={{ marginBottom: 12 }}>
                      Pending Invites
                      <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>({detail.pending_invites.length})</span>
                    </h3>
                    <table>
                      <thead>
                        <tr><th>Email</th><th>Sent</th><th>Expires</th><th></th></tr>
                      </thead>
                      <tbody>
                        {detail.pending_invites.map((inv) => (
                          <tr key={inv.id}>
                            <td style={{ fontSize: 13 }}>{inv.email}</td>
                            <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(inv.created_at)}</td>
                            <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(inv.expires_at)}</td>
                            <td>
                              <button onClick={() => handleCancelInvite(inv.id)} style={{ ...btnSmall, color: "#ef4444" }}>
                                Cancel
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Invite teacher form */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                  <h3 style={{ marginBottom: 12 }}>Invite Teacher</h3>
                  <form onSubmit={handleInvite} style={{ display: "flex", gap: 8 }}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teacher@school.edu"
                      required
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button type="submit" disabled={inviting} style={{ ...btnPrimary, opacity: inviting ? 0.6 : 1, whiteSpace: "nowrap" }}>
                      {inviting ? "Sending..." : "Send Invite"}
                    </button>
                  </form>
                  {inviteResult && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>Invite created!</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ fontSize: 12, color: "#475569", flex: 1, wordBreak: "break-all" }}>
                          {inviteResult}
                        </code>
                        <button
                          onClick={() => handleCopy(inviteResult, "invite-url")}
                          style={{ ...btnSmall, color: copiedId === "invite-url" ? "#16a34a" : "#6366f1" }}
                        >
                          {copiedId === "invite-url" ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared sub-components ──────────────────────────────────────── */

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* ── Shared styles ──────────────────────────────────────────────── */

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
  maxWidth: 720,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};
