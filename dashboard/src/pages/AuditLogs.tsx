import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type AdminActionLogData,
  type StudentAccessLogData,
} from "../lib/api";
import { Pagination } from "../components/Pagination";

/**
 * Audit log viewer for the two compliance trails:
 *  - FERPA student-record access (teacher/admin reads)
 *  - Admin actions (writes — delete, role change, etc.)
 *
 * Single page, two tabs. URL-driven filters for deep links
 * (e.g. /audit-logs?tab=admin-actions&action=user.*). Pagination is
 * offset-based to match the backend; the visible page size matches
 * other operational pages.
 */

type Tab = "student-access" | "admin-actions";
const PAGE_SIZE = 50;

export default function AuditLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab =
    searchParams.get("tab") === "admin-actions" ? "admin-actions" : "student-access";

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "admin-actions") params.set("tab", "admin-actions");
    else params.delete("tab");
    params.delete("offset");
    setSearchParams(params);
  };

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">Compliance</span>
        <h1>Audit logs</h1>
        <p>
          FERPA disclosure tracking and admin action history. Surface
          to districts on request as part of compliance reviews.
        </p>
      </div>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          className={tab === "student-access" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("student-access")}
        >
          Student record access
        </button>
        <button
          type="button"
          className={tab === "admin-actions" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("admin-actions")}
        >
          Admin actions
        </button>
      </div>

      {tab === "student-access" ? <StudentAccessTab /> : <AdminActionsTab />}
    </div>
  );
}

function StudentAccessTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<StudentAccessLogData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetStudentId = searchParams.get("target_student_id") ?? "";
  const accessorUserId = searchParams.get("accessor_user_id") ?? "";
  const recordType = searchParams.get("record_type") ?? "";
  const offset = Number(searchParams.get("offset") ?? "0");

  useEffect(() => {
    let cancelled = false;
    // No setData(null) reset here — eslint rule
    // react-hooks/set-state-in-effect catches the cascade. Stale data
    // stays visible until the new fetch resolves, which is fine for an
    // admin tool and avoids a flicker.
    api
      .studentAccessLog({
        target_student_id: targetStudentId,
        accessor_user_id: accessorUserId,
        record_type: recordType,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [targetStudentId, accessorUserId, recordType, offset]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("offset");
    setSearchParams(params);
  }

  function updateOffset(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next > 0) params.set("offset", String(next));
    else params.delete("offset");
    setSearchParams(params);
  }

  return (
    <div>
      <div className="filters" style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <input
          placeholder="Target student ID (UUID)"
          value={targetStudentId}
          onChange={(e) => updateFilter("target_student_id", e.target.value.trim())}
          style={{ minWidth: 320 }}
        />
        <input
          placeholder="Accessor user ID (UUID)"
          value={accessorUserId}
          onChange={(e) => updateFilter("accessor_user_id", e.target.value.trim())}
          style={{ minWidth: 320 }}
        />
        <input
          placeholder="Record type"
          value={recordType}
          onChange={(e) => updateFilter("record_type", e.target.value.trim())}
          style={{ minWidth: 200 }}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="loading">Loading…</p>}

      {data && (
        <div className="table-card" style={{ marginTop: 16 }}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Accessor</th>
                  <th>Role</th>
                  <th>Target student</th>
                  <th>Record type</th>
                  <th>Record ID</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.accessed_at).toLocaleString()}</td>
                    <td>
                      <div>{e.accessor_name ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {e.accessor_email ?? e.accessor_user_id ?? ""}
                      </div>
                    </td>
                    <td>{e.accessor_role}</td>
                    <td>
                      <div>{e.target_student_name ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>{e.target_student_id ?? ""}</div>
                    </td>
                    <td>{e.record_type}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>
                      {e.record_id ?? "—"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>
                      {e.ip_address ?? "—"}
                    </td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#888" }}>
                      No access records match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={updateOffset}
          />
        </div>
      )}
    </div>
  );
}

function AdminActionsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<AdminActionLogData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adminUserId = searchParams.get("admin_user_id") ?? "";
  const action = searchParams.get("action") ?? "";
  const targetType = searchParams.get("target_type") ?? "";
  const offset = Number(searchParams.get("offset") ?? "0");

  useEffect(() => {
    let cancelled = false;
    // No setData(null) reset — see StudentAccessTab for rationale.
    api
      .adminActionLog({
        admin_user_id: adminUserId,
        action,
        target_type: targetType,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [adminUserId, action, targetType, offset]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("offset");
    setSearchParams(params);
  }

  function updateOffset(next: number) {
    const params = new URLSearchParams(searchParams);
    if (next > 0) params.set("offset", String(next));
    else params.delete("offset");
    setSearchParams(params);
  }

  return (
    <div>
      <div className="filters" style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <input
          placeholder="Admin user ID (UUID)"
          value={adminUserId}
          onChange={(e) => updateFilter("admin_user_id", e.target.value.trim())}
          style={{ minWidth: 320 }}
        />
        <input
          placeholder='Action (e.g. "user.delete" or "user.*")'
          value={action}
          onChange={(e) => updateFilter("action", e.target.value.trim())}
          style={{ minWidth: 260 }}
        />
        <input
          placeholder="Target type (user, school, etc.)"
          value={targetType}
          onChange={(e) => updateFilter("target_type", e.target.value.trim())}
          style={{ minWidth: 200 }}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="loading">Loading…</p>}

      {data && (
        <div className="table-card" style={{ marginTop: 16 }}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Metadata</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.performed_at).toLocaleString()}</td>
                    <td>
                      <div>{e.admin_name ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {e.admin_email ?? e.admin_user_id ?? ""}
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{e.action}</td>
                    <td>
                      <div>{e.target_type}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>
                        {e.target_id ?? "—"}
                      </div>
                    </td>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "#888",
                        maxWidth: 320,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {e.metadata ? JSON.stringify(e.metadata) : "—"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>
                      {e.ip_address ?? "—"}
                    </td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "#888" }}>
                      No admin actions match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={updateOffset}
          />
        </div>
      )}
    </div>
  );
}
