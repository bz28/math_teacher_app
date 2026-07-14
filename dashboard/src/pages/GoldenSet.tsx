import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type GoldenCase,
  type GoldenSetData,
  type GoldenStatus,
} from "../lib/api";
import StatTile, { type TileTone } from "../components/StatTile";
import StatusPill, { type PillTone } from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import ErrorState from "../components/ErrorState";

// One status system for the whole console (mirrors StatusPill tones).
const STATUS: Record<GoldenStatus, { tone: PillTone; label: string; color: string }> = {
  pass: { tone: "ok", label: "PASS", color: "var(--ok)" },
  fail: { tone: "danger", label: "FAIL", color: "var(--danger)" },
  pending: { tone: "neutral", label: "PENDING", color: "var(--muted-2)" },
};

// Failures first: a regression is the loudest, then a plain fail, then the
// not-yet-evaluated, then the passing cases.
function rank(c: GoldenCase): number {
  if (c.is_regression) return 0;
  if (c.last_status === "fail") return 1;
  if (c.last_status === "pending") return 2;
  return 3;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

type Filter = "all" | "fail" | "pass" | "pending" | "retired";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fail", label: "Failing" },
  { key: "pass", label: "Passing" },
  { key: "pending", label: "Pending" },
  { key: "retired", label: "Retired" },
];

const EMPTY_FORM = {
  probe: "geometry",
  name: "",
  constraint: "",
  adversarial: false,
  expected_shapes: "",
  rationale: "",
};

export default function GoldenSet() {
  const [data, setData] = useState<GoldenSetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");

  const [selected, setSelected] = useState<GoldenCase | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .goldenSet()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep an open drawer in sync with refreshed data (e.g. after a retire).
  useEffect(() => {
    if (!selected || !data) return;
    const fresh = data.cases.find((c) => c.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [data, selected]);

  const rows = useMemo(() => {
    if (!data) return [];
    const base = data.cases.filter((c) =>
      filter === "retired" ? c.retired : !c.retired && (filter === "all" || c.last_status === filter),
    );
    return [...base].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [data, filter]);

  const openReport = (id: string) => {
    setLoadingReport(true);
    api
      .harnessReport(id)
      .then((r) => setReportHtml(r.html))
      .catch(() => setReportHtml("<p style='padding:24px;font-family:system-ui'>No stored report for the run that last evaluated this case.</p>"))
      .finally(() => setLoadingReport(false));
  };

  const submitAdd = async () => {
    setBusy(true);
    try {
      await api.addGoldenCase({
        probe: form.probe.trim(),
        name: form.name.trim(),
        constraint: form.constraint.trim(),
        adversarial: form.adversarial,
        expected_shapes: form.expected_shapes.split(",").map((s) => s.trim()).filter(Boolean),
        rationale: form.rationale.trim() || null,
      });
      setAdding(false);
      setForm(EMPTY_FORM);
      setToast("Golden case added — pending until the next eval run.");
      reload();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't add case");
    } finally {
      setBusy(false);
    }
  };

  const retire = async (c: GoldenCase) => {
    setBusy(true);
    try {
      await api.retireGoldenCase(c.id, !c.retired);
      setToast(c.retired ? "Case restored to the set." : "Case retired.");
      if (!c.retired) setSelected(null);
      reload();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't update case");
    } finally {
      setBusy(false);
    }
  };

  const rerunAll = async () => {
    setBusy(true);
    try {
      const { requested } = await api.rerunGoldenEval();
      setToast(`${requested} case${requested === 1 ? "" : "s"} queued — the harness re-runs the corpus on its next pass.`);
      reload();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't request re-run");
    } finally {
      setBusy(false);
    }
  };

  if (!data && error) {
    return <ErrorState message={error} onRetry={() => { setError(null); reload(); }} />;
  }

  const stats = data?.stats;
  const evaluated = stats?.pass_rate.evaluated ?? 0;
  const passing = stats?.pass_rate.passing ?? 0;
  const passPct = evaluated > 0 ? Math.round((passing / evaluated) * 100) : null;
  const regressions = stats?.regressions ?? 0;
  const passTone: TileTone = passPct === null ? "default" : passPct === 100 ? "ok" : passPct >= 80 ? "warn" : "danger";

  const columns: Column<GoldenCase>[] = [
    {
      key: "name", header: "Case", width: "34%",
      sortValue: (c) => c.name,
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>{c.name}</div>
          {c.rationale && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.rationale}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "probe", header: "Course", width: "14%",
      sortValue: (c) => c.probe,
      render: (c) => <span className="gs-course">{c.probe}</span>,
    },
    {
      key: "format", header: "Format", width: "14%",
      sortValue: (c) => (c.adversarial ? "adversarial" : "coverage"),
      render: (c) => (
        <span className={`gs-fmt-tag${c.adversarial ? " gs-fmt-adv" : ""}`}>
          {c.adversarial ? "adversarial" : "coverage"}
        </span>
      ),
    },
    {
      key: "status", header: "Status", width: "18%",
      sortValue: (c) => rank(c),
      render: (c) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusPill tone={STATUS[c.last_status].tone} label={STATUS[c.last_status].label} />
          {c.is_regression && <span className="gs-reg-tag">REGRESSION</span>}
          {c.rerun_requested && <span className="gs-queued-tag">queued</span>}
        </span>
      ),
    },
    {
      key: "lastrun", header: "Last run", width: "20%",
      sortValue: (c) => c.last_run_at ?? "",
      render: (c) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-soft)" }}>{relTime(c.last_run_at)}</div>
          {c.last_model && <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{c.last_model}</div>}
        </div>
      ),
    },
  ];

  return (
    <div className="gs-page">
      <div className="gs-head">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Diagnostics · Generation QA</span>
          <h1>Golden Set</h1>
          <p>The eval golden set at a glance — which curated cases still pass, so a regression is caught the moment it lands.</p>
        </div>
        {regressions > 0 && <StatusPill tone="danger" label={`${regressions} REGRESSION${regressions === 1 ? "" : "S"}`} />}
      </div>

      <div className="tile-grid">
        <StatTile label="Set size" value={stats?.set_size ?? "—"} sub="active golden cases" />
        <StatTile
          label="Last eval run"
          value={stats ? relTime(stats.last_run.at) : "—"}
          sub={stats?.last_run.model ?? "not yet evaluated"}
        />
        <StatTile
          label="Pass rate"
          tone={passTone}
          value={passPct === null ? "—" : `${passPct}%`}
          sub={`${passing}/${evaluated} evaluated cases`}
        />
        <StatTile
          label="Regressions"
          tone={regressions > 0 ? "danger" : "ok"}
          value={regressions}
          sub="passing cases now failing"
        />
      </div>

      <div className="gs-toolbar">
        <div className="gs-filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`gs-chip${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="gs-actions">
          <button className="gs-btn" onClick={rerunAll} disabled={busy || !data}>Re-run eval</button>
          <button className="gs-btn gs-btn-primary" onClick={() => setAdding(true)} disabled={busy}>Add case</button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={(c) => setSelected(c)}
        rowStatus={(c) => (c.is_regression ? "var(--danger)" : STATUS[c.last_status].color)}
        drill
        loading={!data}
        empty={<span className="dt-state-title">No cases match this filter.</span>}
        minWidth={760}
      />

      {/* ── Drill-in: case detail + model's last output + failure report ── */}
      {selected && (
        <Drawer onClose={() => setSelected(null)} title={selected.name}>
          <div className="gs-detail-meta">
            <StatusPill tone={STATUS[selected.last_status].tone} label={STATUS[selected.last_status].label} />
            {selected.is_regression && <span className="gs-reg-tag">REGRESSION</span>}
            <span className="gs-course">{selected.probe}</span>
            <span className={`gs-fmt-tag${selected.adversarial ? " gs-fmt-adv" : ""}`}>
              {selected.adversarial ? "adversarial" : "coverage"}
            </span>
            <span className="gs-detail-when">
              last run {relTime(selected.last_run_at)}{selected.last_model ? ` · ${selected.last_model}` : ""}
            </span>
          </div>

          <div className="gs-detail-block">
            <div className="gs-detail-label">The steer — what generation was asked to produce</div>
            <p className="gs-steer">{selected.constraint}</p>
            {selected.expected_shapes.length > 0 && (
              <div className="gs-shapes">
                {selected.expected_shapes.map((s) => <span key={s} className="gs-shape">{s}</span>)}
              </div>
            )}
          </div>

          {selected.rationale && (
            <div className="gs-detail-block">
              <div className="gs-detail-label">Why this case exists</div>
              <p className="gs-rationale">{selected.rationale}</p>
            </div>
          )}

          <div className="gs-detail-block">
            <div className="gs-detail-label">Model's last-run output</div>
            <p className={`gs-output${selected.last_status === "fail" ? " gs-output-fail" : ""}`}>
              {selected.last_output ?? "This case hasn't been evaluated yet."}
            </p>
          </div>

          <div className="gs-detail-foot">
            {selected.last_run_id ? (
              <button className="gs-btn" onClick={() => openReport(selected.last_run_id!)} disabled={loadingReport}>
                {loadingReport ? "Loading…" : "View eval report"}
              </button>
            ) : (
              <span className="gs-detail-note">No linked eval report yet.</span>
            )}
            <button className="gs-btn gs-btn-danger" onClick={() => retire(selected)} disabled={busy}>
              {selected.retired ? "Restore to set" : "Retire case"}
            </button>
          </div>
        </Drawer>
      )}

      {/* ── Add a golden case ── */}
      {adding && (
        <Drawer onClose={() => setAdding(false)} title="Add golden case">
          <div className="gs-form">
            <label className="gs-field">
              <span>Course / probe</span>
              <input value={form.probe} onChange={(e) => setForm({ ...form, probe: e.target.value })} placeholder="geometry" />
            </label>
            <label className="gs-field">
              <span>Case name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Near-degenerate sliver triangle" />
            </label>
            <label className="gs-field">
              <span>The steer (constraint)</span>
              <textarea rows={3} value={form.constraint} onChange={(e) => setForm({ ...form, constraint: e.target.value })} placeholder="Generate a triangle with sides 100, 99.5, 1…" />
            </label>
            <label className="gs-field">
              <span>Expected shapes (comma-separated)</span>
              <input value={form.expected_shapes} onChange={(e) => setForm({ ...form, expected_shapes: e.target.value })} placeholder="triangle, circle" />
            </label>
            <label className="gs-field">
              <span>Rationale (optional)</span>
              <textarea rows={2} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} placeholder="Why this case matters" />
            </label>
            <label className="gs-check">
              <input type="checkbox" checked={form.adversarial} onChange={(e) => setForm({ ...form, adversarial: e.target.checked })} />
              <span>Adversarial (a deliberately hostile edge case)</span>
            </label>
          </div>
          <div className="gs-detail-foot">
            <button className="gs-btn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button
              className="gs-btn gs-btn-primary"
              onClick={submitAdd}
              disabled={busy || !form.name.trim() || !form.constraint.trim() || !form.probe.trim()}
            >
              {busy ? "Adding…" : "Add case"}
            </button>
          </div>
        </Drawer>
      )}

      {/* ── The linked harness failure report (reuses /harness-runs/{id}/report) ── */}
      {reportHtml !== null && <ReportModal html={reportHtml} onClose={() => setReportHtml(null)} />}

      {toast && <div className="toast-card gs-toast">{toast}</div>}
    </div>
  );
}

function useEscClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscClose(onClose);
  return (
    <div className="gs-modal-overlay" onClick={onClose}>
      <div className="gs-drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="gs-modal-head">
          <b>{title}</b>
          <button className="gs-modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="gs-drawer-body">{children}</div>
      </div>
    </div>
  );
}

function ReportModal({ html, onClose }: { html: string; onClose: () => void }) {
  useEscClose(onClose);
  return (
    <div className="gs-modal-overlay" onClick={onClose}>
      <div className="gs-report-modal" role="dialog" aria-modal="true" aria-label="Eval report" onClick={(e) => e.stopPropagation()}>
        <div className="gs-modal-head">
          <b>Eval report</b>
          <button className="gs-modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <iframe title="Eval report" srcDoc={html} sandbox="" className="gs-report-frame" />
      </div>
    </div>
  );
}
