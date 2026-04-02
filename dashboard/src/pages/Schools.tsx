import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type SchoolListItem, type SchoolDetail } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { btnGhost, btnPrimary, btnSmall, inputStyle, overlay } from "../lib/styles";
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

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<SchoolListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Copied feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const reload = () => {
    setLoading(true);
    api.schools().then((d) => setSchools(d.schools)).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  // Auto-open detail modal from query param (e.g. /schools?detail=xxx)
  useEffect(() => {
    const detailId = searchParams.get("detail");
    if (detailId && !detail && !loadingDetail) {
      handleViewDetail(detailId);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

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
    setEditing(false);
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

  const startEditing = () => {
    if (!detail) return;
    setEditForm({
      name: detail.name,
      contact_name: detail.contact_name,
      contact_email: detail.contact_email,
      city: detail.city || "",
      state: detail.state || "",
      notes: detail.notes || "",
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await api.updateSchool(detail.id, {
        name: editForm.name.trim(),
        contact_name: editForm.contact_name.trim(),
        contact_email: editForm.contact_email.trim(),
        city: editForm.city.trim() || undefined,
        state: editForm.state.trim() || undefined,
        notes: editForm.notes.trim() || undefined,
      });
      setEditing(false);
      handleViewDetail(detail.id);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSchool(deleteTarget.id);
      setDeleteTarget(null);
      if (detail?.id === deleteTarget.id) setDetail(null);
      reload();
      alert("School deleted. If this was converted from a lead, don't forget to update the lead status in the Leads tab.");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <p>Loading...</p>;

  const totalSchools = schools.length;
  const activeSchools = schools.filter((s) => s.is_active).length;
  const totalTeachers = schools.reduce((sum, s) => sum + s.teacher_count, 0);

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
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>School</th>
              <th>Contact</th>
              <th>Teachers</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Updated</th>
              <th>Added</th>
              <th></th>
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
                <td>
                  <span className="badge" style={
                    s.is_active
                      ? { background: "#dcfce7", color: "#16a34a" }
                      : { background: "#fef2f2", color: "#dc2626" }
                  }>
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {s.notes ? (
                    <div style={{ fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.notes}>
                      {s.notes}
                    </div>
                  ) : (
                    <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td>
                  {s.updated_by ? (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{s.updated_by}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.updated_at ? formatRelativeDate(s.updated_at) : ""}</div>
                    </div>
                  ) : (
                    <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(s.created_at)}</td>
                <td>
                  <div className="action-menu-wrapper">
                    <button
                      className="action-toggle"
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id); }}
                    >
                      ...
                    </button>
                    {openMenu === s.id && (
                      <div className="action-dropdown" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setOpenMenu(null); handleViewDetail(s.id); }}>
                          View Details
                        </button>
                        <button onClick={() => { setOpenMenu(null); handleToggleActive(s); }}>
                          {s.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button className="danger" onClick={() => { setOpenMenu(null); setDeleteTarget(s); }}>
                          Delete School
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {schools.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 48 }}>
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

      {/* ── Delete confirmation modal ──────────────────────────── */}
      {deleteTarget && (
        <div style={overlay} onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="table-card" style={{ ...modalCard, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 8, color: "#dc2626" }}>Delete School</h2>
            <p style={{ color: "#475569", marginBottom: 16 }}>
              Permanently delete <strong>{deleteTarget.name}</strong>?
            </p>
            <ul style={{ color: "#64748b", fontSize: 13, marginBottom: 20, paddingLeft: 20 }}>
              <li>{deleteTarget.teacher_count} teacher{deleteTarget.teacher_count !== 1 ? "s" : ""} will be unlinked from this school</li>
              <li>All pending invites will be cancelled</li>
              <li>This cannot be undone</li>
            </ul>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} style={btnGhost}>Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ ...btnPrimary, background: "#dc2626", opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? "Deleting..." : "Delete School"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── School detail modal ─────────────────────────────────── */}
      {(detail || loadingDetail) && (
        <div style={overlay} onClick={() => { setDetail(null); setInviteResult(null); }}>
          <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <p style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading...</p>
            ) : detail && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                  {editing ? (
                    <div style={{ flex: 1, marginRight: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <FormField label="School Name">
                          <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required style={inputStyle} />
                        </FormField>
                        <FormField label="Contact Name">
                          <input type="text" value={editForm.contact_name} onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })} required style={inputStyle} />
                        </FormField>
                        <FormField label="Contact Email">
                          <input type="email" value={editForm.contact_email} onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })} required style={inputStyle} />
                        </FormField>
                        <div style={{ display: "flex", gap: 8 }}>
                          <FormField label="City">
                            <input type="text" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} style={inputStyle} />
                          </FormField>
                          <FormField label="State">
                            <input type="text" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} style={{ ...inputStyle, maxWidth: 80 }} />
                          </FormField>
                        </div>
                      </div>
                      <FormField label="Notes">
                        <textarea
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          placeholder="Deal context, pricing, etc."
                          rows={3}
                          style={{ ...inputStyle, resize: "vertical" }}
                        />
                      </FormField>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                        <button onClick={() => setEditing(false)} disabled={saving} style={btnGhost}>Cancel</button>
                        <button onClick={handleSaveEdit} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                          {saving ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </div>
                  ) : (
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
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    {!editing && <button onClick={startEditing} style={btnSmall}>Edit</button>}
                    <button onClick={() => { setDetail(null); setEditing(false); setInviteResult(null); }} style={btnGhost}>Close</button>
                  </div>
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

const modalCard: React.CSSProperties = {
  maxWidth: 720,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};
