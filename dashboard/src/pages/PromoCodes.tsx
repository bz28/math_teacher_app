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
    const action = code.is_active ? "deactivate" : "activate";
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

  if (loading) return <p>Loading...</p>;

  const totalCodes = codes.length;
  const activeCodes = codes.filter((c) => c.is_active).length;
  const totalRedemptions = codes.reduce((sum, c) => sum + c.times_redeemed, 0);

  return (
    <div>
      <h1>Promo Codes</h1>

      <div className="stat-grid">
        <StatCard label="Total Codes" value={totalCodes} />
        <StatCard label="Active Codes" value={activeCodes} />
        <StatCard label="Total Redemptions" value={totalRedemptions} />
      </div>

      {/* Create button / form */}
      {!showCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          style={{
            marginBottom: 16,
            padding: "10px 20px",
            background: "#6366f1",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          + Create Promo Code
        </button>
      ) : (
        <div className="table-card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Create New Code</h3>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>Code</label>
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="e.g. BETA30"
                required
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 14, width: 160 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>Duration (days)</label>
              <input
                type="number"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                min="0"
                required
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 14, width: 120 }}
              />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>0 = lifetime</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>Max Uses</label>
              <input
                type="number"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                min="1"
                required
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 14, width: 100 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>Expires (optional)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 14 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  padding: "8px 20px",
                  background: "#6366f1",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                style={{
                  padding: "8px 16px",
                  background: "#f1f5f9",
                  color: "#475569",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Codes table */}
      <div className="table-card">
        <h3 style={{ marginBottom: 12 }}>All Codes</h3>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Duration</th>
              <th>Redemptions</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id}>
                <td>
                  <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 14, letterSpacing: 1 }}>
                    {c.code}
                  </span>
                </td>
                <td>{c.duration_days === 0 ? "Lifetime" : `${c.duration_days} days`}</td>
                <td>
                  <span
                    style={{
                      fontWeight: 600,
                      color: c.times_redeemed >= c.max_redemptions ? "#ef4444" : "#475569",
                    }}
                  >
                    {c.times_redeemed} / {c.max_redemptions}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${c.is_active ? "badge-active" : ""}`}
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
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleViewRedemptions(c)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        borderRadius: 4,
                        border: "1px solid #e2e8f0",
                        background: "#fff",
                        cursor: "pointer",
                        color: "#6366f1",
                        fontWeight: 600,
                      }}
                    >
                      View ({c.times_redeemed})
                    </button>
                    <button
                      onClick={() => handleToggleActive(c)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        borderRadius: 4,
                        border: "1px solid #e2e8f0",
                        background: "#fff",
                        cursor: "pointer",
                        color: c.is_active ? "#ef4444" : "#16a34a",
                        fontWeight: 600,
                      }}
                    >
                      {c.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {codes.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "#999", padding: 32 }}>
                  No promo codes yet. Create one above!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Redemptions modal */}
      {viewingCode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setViewingCode(null)}
        >
          <div
            className="table-card"
            style={{ maxWidth: 600, width: "90%", maxHeight: "70vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ marginBottom: 0 }}>
                Redemptions for <span style={{ fontFamily: "monospace" }}>{viewingCode.code}</span>
              </h3>
              <button
                onClick={() => setViewingCode(null)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}
              >
                x
              </button>
            </div>
            {loadingRedemptions ? (
              <p>Loading...</p>
            ) : redemptions.length === 0 ? (
              <p style={{ color: "#94a3b8", textAlign: "center", padding: 24 }}>No redemptions yet.</p>
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
                      <td style={{ fontSize: 13 }}>{r.user_email}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{formatRelativeDate(r.redeemed_at)}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{r.expires_at ? formatRelativeDate(r.expires_at) : "Lifetime"}</td>
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
