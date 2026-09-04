import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import DataTable, { type Column } from "./DataTable";
import StatusPill, { type PillTone } from "./StatusPill";
import { api, type TeacherAssignmentsData } from "../lib/api";

/**
 * Everything this teacher has assigned, newest first.
 *
 * The activity timeline beside this only shows the window you happen to
 * be reading — it answers "what did she do on Tuesday". It cannot answer
 * "what has she assigned all term", and it never shows the draft she
 * started and walked away from, because abandoning a draft produces no
 * event worth logging. That row is often the interesting one.
 *
 * Each row drills into the assignment as she built it.
 */

const FETCH_LIMIT = 200;

const STATUS_TONE: Record<string, PillTone> = {
  published: "live",
  draft: "neutral",
  closed: "info",
};

type Row = TeacherAssignmentsData["assignments"][number];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function TeacherAssignments({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<TeacherAssignmentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .teacherAssignments(teacherId, { limit: String(FETCH_LIMIT) })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId, reloadKey]);

  const rows = data?.assignments ?? [];
  // Say so rather than quietly showing a prefix: sorting or scanning a
  // slice answers a different question than the one the reader asked.
  const truncated = data !== null && data.total > rows.length;

  const columns: Column<Row>[] = [
    {
      key: "title",
      header: "Title",
      render: (r) => r.title,
      sortValue: (r) => r.title,
      width: "42%",
    },
    {
      key: "type",
      header: "Type",
      render: (r) => <span className="muted">{r.type}</span>,
      sortValue: (r) => r.type,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"} label={r.status} pulse={false} />
      ),
      sortValue: (r) => r.status,
    },
    {
      key: "problems",
      header: "Problems",
      align: "right",
      numeric: true,
      // Null for practice sets, whose problems aren't in `content` — a
      // dash says "open it to see", which is true. A zero would be a
      // number the reader has no way to know is wrong.
      render: (r) => (r.problem_count === null ? "—" : r.problem_count),
      sortValue: (r) => r.problem_count ?? -1,
    },
    {
      key: "published",
      header: "Published",
      align: "right",
      render: (r) => (
        <span className="mono" title={r.first_published_at ?? undefined}>
          {fmtDate(r.first_published_at)}
        </span>
      ),
      sortValue: (r) => r.first_published_at ?? "",
    },
  ];

  return (
    <>
      {truncated && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
          Showing the {rows.length} most recent of {data?.total}.
        </p>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={data === null && !error}
        error={error}
        onRetry={() => {
          // Clear first, so the retry renders as loading rather than
          // leaving the failure on screen for the length of the request.
          setError(null);
          setReloadKey((k) => k + 1);
        }}
        drill
        onRowClick={(r) => navigate(`/assignments/${r.id}`)}
        empty="This teacher hasn't created any assignments yet."
      />
    </>
  );
}
