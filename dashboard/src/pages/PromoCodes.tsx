import { useEffect, useState } from "react";
import { api, type PromoCodeData, type PromoRedemptionData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";

export default function PromoCodes() {
  const [codes, setCodes] = useState<PromoCodeData[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [maxRedemptions, setMaxRedemptions] = useState("10");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);

  // Redemptions modal
  const [viewingCode, setViewingCode] = useState<PromoCodeData | null>(null);
  const [redemptions, setRedemptions] = useState<PromoRedemptionData[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);

  // Copied feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.promoCodes().then(setCodes).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createPromoCode({
        code: newCode.trim(),
        duration_days: parseInt(durationDays),
        max_redemptions: parseInt(maxRedemptions),
        expires_at: expiresAt || undefined,
      });
      setNewCode("");
      setDurationDays("30");
      setMaxRedemptions("10");
      setExpiresAt("");
      setShowCreate(false);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (code: PromoCodeData) => {
    const action = code.is_active ? "Deactivate" : "Activate";
    if (!confirm(`${action} code "${code.code}"?`)) return;
    try {
      await api.updatePromoCode(code.id, { is_active: !code.is_active });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleViewRedemptions = async (code: PromoCodeData) => {
    setViewingCode(code);
    setLoadingRedemptions(true);
    try {
      const data = await api.promoRedemptions(code.id);
      setRedemptions(data);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoadingRedemptions(false);
    }
  };

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (loading) return <p>Loading...</p>;

  const totalCodes = codes.length;
  const activeCodes = codes.filter((c) => c.is_active).length;
  const totalRedemptions = codes.reduce((sum, c) => sum + c.times_redeemed, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ marginBottom: 0 }}>Promo Codes</h1>
        {!showCreate && (
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>
            + New Code
          </button>
        )}
      </div>

      <div className="stat-grid">
        <StatCard label="Total Codes" value={totalCodes} />
        <StatCard label="Active" value={activeCodes} />
        <StatCard label="Total Redemptions" value={totalRedemptions} />
      </div>

      {/* ── Create form ─────────────────────────────────────────── */}
      {showCreate && (
        <div className="table-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ marginBottom: 0 }}>Create New Code</h3>
            <button onClick={() => setShowCreate(false)} style={btnGhost}>Cancel</button>
          </div>
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField label="Code">
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="e.g. BETA30"
                required
                style={inputStyle}
              />
            </FormField>
            <FormField label="Duration" hint="0 = lifetime">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  min="0"
                  required
                  style={{ ...inputStyle, flex: 1 }}
                />
                <span style={{ fontSize: 13, color: "#64748b" }}>days</span>
              </div>
            </FormField>
            <FormField label="Max Redemptions">
              <input
                type="number"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                min="1"
                required
                style={inputStyle}
              />
            </FormField>
            <FormField label="Code Expiry — UTC (optional)">
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={creating} style={{ ...btnPrimary, opacity: creating ? 0.6 : 1 }}>
                {creating ? "Creating..." : "Create Code"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Codes table ─────────────────────────────────────────── */}
      <div className="table-card">
        <h3 style={{ marginBottom: 12 }}>
          All Codes
          <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>({totalCodes})</span>
        </h3>
        <div className="table-scroll">
        <table>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Code</th>
              <th>Duration</th>
              <th>Redemptions</th>
              <th>Status</th>
              <th>Code Expiry</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => {
              const pct = c.max_redemptions > 0 ? Math.min((c.times_redeemed / c.max_redemptions) * 100, 100) : 0;
              const isFull = c.times_redeemed >= c.max_redemptions;
              return (
                <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 14, letterSpacing: 0.5 }}>
                        {c.code}
                      </span>
                      <button
                        onClick={() => handleCopy(c.code, c.id)}
                        title="Copy to clipboard"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 13,
                          color: copiedId === c.id ? "#16a34a" : "#94a3b8",
                          padding: "2px 4px",
                        }}
                      >
                        {copiedId === c.id ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: c.duration_days === 0 ? "#fef3c7" : "#f0f9ff", color: c.duration_days === 0 ? "#b45309" : "#0369a1" }}>
                      {c.duration_days === 0 ? "Lifetime" : `${c.duration_days}d`}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
                        <div style={{
                          width: `${pct}%`,
                          height: "100%",
                          borderRadius: 3,
                          background: isFull ? "#ef4444" : "#6366f1",
                          transition: "width 0.3s",
                        }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isFull ? "#ef4444" : "#475569", whiteSpace: "nowrap" }}>
                        {c.times_redeemed}/{c.max_redemptions}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={
                        c.is_active
                          ? { background: "#dcfce7", color: "#16a34a" }
                          : { background: "#f1f5f9", color: "#94a3b8" }
                      }
                    >
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "#64748b" }}>
                    {c.expires_at ? formatRelativeDate(c.expires_at) : "Never"}
                  </td>
                  <td style={{ fontSize: 12, color: "#64748b" }}>
                    {formatRelativeDate(c.created_at)}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => handleViewRedemptions(c)} style={btnSmall}>
                        Redemptions
                      </button>
                      <button
                        onClick={() => handleToggleActive(c)}
                        style={{ ...btnSmall, color: c.is_active ? "#ef4444" : "#16a34a" }}
                      >
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {codes.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 48 }}>
                  <div style={{ color: "#94a3b8" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>No promo codes yet</div>
                    <div style={{ fontSize: 14 }}>Click "+ New Code" to create your first promo code.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Redemptions modal ───────────────────────────────────── */}
      {viewingCode && (
        <div style={overlay} onClick={() => setViewingCode(null)}>
          <div className="table-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ marginBottom: 2 }}>Redemptions</h3>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Code: <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{viewingCode.code}</span>
                  {" — "}
                  {viewingCode.times_redeemed} of {viewingCode.max_redemptions} used
                </div>
              </div>
              <button onClick={() => setViewingCode(null)} style={btnGhost}>Close</button>
            </div>
            {loadingRedemptions ? (
              <p style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading...</p>
            ) : redemptions.length === 0 ? (
              <p style={{ color: "#94a3b8", textAlign: "center", padding: 32 }}>No one has redeemed this code yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Redeemed</th>
                    <th>Pro Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map((r) => (
                    <tr key={r.user_id}>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{r.user_email}</span>
                      </td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(r.redeemed_at)}</td>
                      <td>
                        <span className="badge" style={
                          r.expires_at
                            ? { background: "#f0f9ff", color: "#0369a1" }
                            : { background: "#fef3c7", color: "#b45309" }
                        }>
                          {r.expires_at ? formatRelativeDate(r.expires_at) : "Lifetime"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared sub-components ──────────────────────────────────────── */

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 11, color: "#94a3b8" }}>{hint}</span>}
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
  maxWidth: 640,
  width: "90%",
  maxHeight: "70vh",
  overflow: "auto",
};
