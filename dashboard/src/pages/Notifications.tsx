import { useEffect, useState } from "react";
import { api, type NotificationPrefItem } from "../lib/api";

export default function Notifications() {
  const [prefs, setPrefs] = useState<NotificationPrefItem[] | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.notificationPrefs().then((d) => setPrefs(d.preferences)).catch(() => setError("Failed to load preferences"));
  }, []);

  const toggle = async (eventType: string, currentEnabled: boolean) => {
    setUpdating(eventType);
    setError("");
    try {
      const res = await api.updateNotificationPref(eventType, !currentEnabled);
      setPrefs(res.preferences);
    } catch {
      setError("Failed to update preference");
    } finally {
      setUpdating(null);
    }
  };

  if (!prefs) return <p>{error || "Loading..."}</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Notifications</h1>
        <p>Choose which email alerts you receive. All notifications are enabled by default.</p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th style={{ width: 100, textAlign: "center" }}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => (
              <tr key={p.event_type}>
                <td>
                  <strong style={{ display: "block", marginBottom: 2 }}>{p.label}</strong>
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>{descriptions[p.event_type]}</span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <button
                    className="toggle-btn"
                    data-on={p.enabled}
                    disabled={updating === p.event_type}
                    onClick={() => toggle(p.event_type, p.enabled)}
                    aria-label={`Toggle ${p.label}`}
                  >
                    <span className="toggle-knob" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const descriptions: Record<string, string> = {
  new_user_signup: "Get notified when a new student registers",
  daily_cost_alert: "Alert when daily LLM spend exceeds the configured limit",
  daily_digest: "Daily summary of users, sessions, costs, and errors at midnight UTC",
  error_spike: "Alert when LLM call failures spike",
};
