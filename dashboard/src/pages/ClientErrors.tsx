import { useEffect, useState } from "react";
import { api, type ClientErrorGroup, type ClientErrorsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatTile from "../components/StatTile";
import StatusPill, { type PillTone } from "../components/StatusPill";

// Browser crashes reported by the web app. Before the reporter existed
// these were discarded in production entirely — a teacher saw a retry
// card and we saw nothing — so this page is the first time client-side
// failure has been visible at all.
//
// Grouped, not a flat log. One render crash-loop produces dozens of
// identical rows, and a teacher hitting the same bug forty times is ONE
// thing to fix. Ordered by last-seen rather than count: during a pilot,
// "this is breaking right now" beats "this broke a lot last week".

const KINDS = ["all", "render", "api", "unhandled", "promise"] as const;
type Kind = (typeof KINDS)[number];

// Where the report came from, mapped to the console's shared pill tones.
// A render crash is the loudest failure there is (the tab goes blank), so
// it takes `danger`; the rest are degradations, not outages.
const KIND_TONE: Record<string, PillTone> = {
  render: "danger",
  api: "warn",
  unhandled: "warn",
  promise: "info",
};

const WINDOWS: { label: string; hours: number | null }[] = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
  { label: "All", hours: null },
];

export default function ClientErrors() {
  const [data, setData] = useState<ClientErrorsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [hours, setHours] = useState<number | null>(168);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (kind !== "all") params.kind = kind;
    if (hours !== null) params.hours = String(hours);
    // Reset before refetching so a filter change can't paint the previous
    // window's rows under the new filter. Same pattern (and same lint
    // exemption) as TeacherDetail's per-teacher reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    api
      .clientErrors(params)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [kind, hours]);

  const groups = data?.groups ?? [];
  const totalEvents = data?.total_events ?? 0;
  // From the server, not inferred here: two users often share a display
  // name, and deduping on the name under-reports how many people are hit.
  const affected = data?.distinct_users ?? 0;

  return (
    <>
      <div className="page-header">
        <h1>Client errors</h1>
        <p className="page-sub">
          Crashes reported from real browsers, grouped by cause. Newest first —
          during a pilot, what&rsquo;s breaking now matters more than what broke
          most.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatTile label="Distinct errors" value={String(groups.length)} />
        <StatTile label="Total occurrences" value={String(totalEvents)} />
        <StatTile label="Users affected" value={String(affected)} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div className="segmented" role="tablist" aria-label="Filter by kind">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`segment${kind === k ? " segment-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div
          className="segmented"
          role="tablist"
          aria-label="Time window"
          style={{ marginLeft: "auto" }}
        >
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              role="tab"
              aria-selected={hours === w.hours}
              className={`segment${hours === w.hours ? " segment-active" : ""}`}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {data?.truncated && (
        // Never let a capped scan read as the whole truth.
        <p style={{ fontSize: 12.5, color: "var(--warn)", marginBottom: 12 }}>
          Showing the most recent {totalEvents} events — counts below are a
          floor, not a total. Narrow the window to see exact figures.
        </p>
      )}

      {error ? (
        <div className="empty-state">
          <div className="empty-state-title">Couldn&rsquo;t load errors</div>
          <div>{error}</div>
        </div>
      ) : data === null ? (
        <div className="empty-state">
          <div>Loading…</div>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No errors reported</div>
          <div>
            Nothing has crashed in this window. Reports arrive automatically
            from the web app — nobody has to file them.
          </div>
        </div>
      ) : (
        <section className="table-card">
          {groups.map((g) => (
            <ErrorRow
              key={g.fingerprint}
              group={g}
              open={open === g.fingerprint}
              onToggle={() =>
                setOpen((cur) => (cur === g.fingerprint ? null : g.fingerprint))
              }
            />
          ))}
        </section>
      )}
    </>
  );
}

function ErrorRow({
  group,
  open,
  onToggle,
}: {
  group: ClientErrorGroup;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: "12px 16px",
          cursor: "pointer",
          display: "flex",
          gap: 12,
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--muted)", width: 10 }}>
          {open ? "▼" : "▶"}
        </span>
        <StatusPill
          tone={KIND_TONE[group.kind] ?? "neutral"}
          label={group.kind}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
          <span style={{ fontWeight: 600 }}>{group.message}</span>
          {group.route && (
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              {group.route}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
          ×{group.count}
          {group.user_count > 0 && (
            <> · {group.user_count} {group.user_count === 1 ? "user" : "users"}</>
          )}
          {" · "}
          {formatRelativeDate(group.last_seen)}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px 38px", fontSize: 12.5 }}>
          {group.sample_user && (
            <div style={{ marginBottom: 8, color: "var(--muted)" }}>
              Most recent report from <strong>{group.sample_user}</strong>
            </div>
          )}
          {/* Component stack first: on a render crash it names the broken
              component, which a minified JS stack usually doesn't. */}
          {group.component_stack && (
            <Block title="Component stack" body={group.component_stack} />
          )}
          {group.stack && <Block title="Stack" body={group.stack} />}
          {group.context && (
            <Block title="Context" body={JSON.stringify(group.context, null, 2)} />
          )}
          {group.user_agent && (
            <div style={{ color: "var(--muted)", marginTop: 8 }}>
              {group.user_agent}
            </div>
          )}
          <div style={{ color: "var(--muted)", marginTop: 8 }}>
            First seen {formatRelativeDate(group.first_seen)}
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: "var(--muted)", marginBottom: 4 }}>{title}</div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: "var(--bg-subtle)",
          borderRadius: 6,
          overflowX: "auto",
          fontSize: 11.5,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {body}
      </pre>
    </div>
  );
}
