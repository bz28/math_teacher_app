import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ActivityLogData,
  type ActivityLogEntry,
  type DocumentContent,
  type GenerationAttachments,
  type GenerationJobDetail,
  type GenerationJobSummary,
  type GenerationJobsData,
} from "../lib/api";
import { fmtCost, formatRelativeDate } from "../lib/format";
import { Pagination } from "./Pagination";

// The teacher observability hub, rendered inside TeacherDetail. Two
// panels off one teacher id: the unified action timeline (what they DO)
// and their AI generations (what they MAKE), each drillable to the
// rendered source worksheet + produced problems + LLM cost. Reuses the
// shared api client, Pagination, and format helpers — no new endpoints
// beyond the admin activity/generation reads.

const PAGE_SIZE = 25;

const sectionHeader = (title: string, right: React.ReactNode) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "12px 16px",
      borderBottom: "1px solid var(--rule)",
    }}
  >
    <h2
      style={{
        margin: 0,
        fontSize: 14,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {title}
    </h2>
    <span style={{ color: "var(--muted-2)", fontSize: 12 }}>{right}</span>
  </div>
);

export default function TeacherActivitySection({ teacherId }: { teacherId: string }) {
  return (
    <>
      <ActivityTimeline teacherId={teacherId} />
      <GenerationsPanel teacherId={teacherId} />
    </>
  );
}

// ── Action timeline ──

function ActivityTimeline({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<ActivityLogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .activityLog({
        actor_user_id: teacherId,
        action,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [teacherId, action, offset]);

  return (
    <section className="table-card" style={{ marginBottom: 24 }}>
      {sectionHeader(
        "Activity timeline",
        data ? `${data.total} action${data.total === 1 ? "" : "s"}` : "",
      )}
      <div className="filters" style={{ display: "flex", gap: 12, padding: "12px 16px" }}>
        <input
          placeholder='Filter action (e.g. "grade.*", "assignment.publish")'
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value.trim());
          }}
          style={{ minWidth: 340 }}
        />
      </div>

      {error && <p className="error" style={{ padding: "0 16px" }}>{error}</p>}
      {!data && !error && <p className="loading" style={{ padding: "0 16px" }}>Loading…</p>}

      {data && (
        <>
          {data.entries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No activity yet</div>
              <div className="empty-state-sub">
                This teacher's assignment, generation, and grading actions will appear here.
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "34%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <ActivityRow key={e.id} e={e} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ padding: "0 16px 12px" }}>
            <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
          </div>
        </>
      )}
    </section>
  );
}

function ActivityRow({ e }: { e: ActivityLogEntry }) {
  return (
    <tr>
      <td style={{ fontSize: 12 }} title={new Date(e.performed_at).toLocaleString()}>
        {formatRelativeDate(e.performed_at)}
      </td>
      <td>
        <span className="badge" style={actionBadgeStyle(e.action)}>{e.action}</span>
      </td>
      <td>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.target_type}</div>
        {e.target_id ? (
          e.target_type === "submission" ? (
            // Deep-link into the existing submission trace instead of
            // duplicating student data here.
            <Link
              to={`/submissions/${e.target_id}/trace`}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {shortId(e.target_id)} →
            </Link>
          ) : (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#888" }}>
              {shortId(e.target_id)}
            </span>
          )
        ) : (
          <span style={{ color: "#888" }}>—</span>
        )}
      </td>
      <td
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "#888",
          overflowWrap: "anywhere",
        }}
      >
        {e.metadata ? metaSummary(e.metadata) : "—"}
      </td>
    </tr>
  );
}

// ── Generations ──

function GenerationsPanel({ teacherId }: { teacherId: string }) {
  const [data, setData] = useState<GenerationJobsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .generationJobs({ teacher_id: teacherId, limit: String(PAGE_SIZE), offset: String(offset) })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [teacherId, offset]);

  return (
    <section className="table-card" style={{ marginBottom: 24 }}>
      {sectionHeader(
        "AI generations",
        data ? `${data.total} job${data.total === 1 ? "" : "s"}` : "",
      )}
      {error && <p className="error" style={{ padding: "12px 16px" }}>{error}</p>}
      {!data && !error && <p className="loading" style={{ padding: "12px 16px" }}>Loading…</p>}

      {data && (
        <>
          {data.jobs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No generations yet</div>
              <div className="empty-state-sub">
                When this teacher generates or uploads problems, each job appears here — drill in
                to see the source worksheet and produced problems.
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Focus</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Produced</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <Fragment key={j.id}>
                      <tr
                        className="clickable"
                        onClick={() => setOpenId(openId === j.id ? null : j.id)}
                      >
                        <td style={{ fontSize: 12 }} title={new Date(j.created_at).toLocaleString()}>
                          {formatRelativeDate(j.created_at)}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {j.constraint || <span style={{ color: "#888" }}>—</span>}
                          <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
                            {[j.course_name, j.unit_name].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: "var(--info-soft)", color: "var(--info)" }}>
                            {j.mode}
                          </span>
                        </td>
                        <td>
                          <span className="badge" style={statusBadgeStyle(j.status)}>{j.status}</span>
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                          {j.produced_count}/{j.requested_count || "?"}
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                          {fmtCost(j.llm_cost_usd)}
                          <span style={{ color: "var(--muted-2)", fontSize: 11 }}>
                            {" "}({j.llm_call_count})
                          </span>
                        </td>
                      </tr>
                      {openId === j.id && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--paper-2)", padding: 0 }}>
                            <GenerationDrillIn jobId={j.id} summary={j} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ padding: "0 16px 12px" }}>
            <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
          </div>
        </>
      )}
    </section>
  );
}

function GenerationDrillIn({ jobId, summary }: { jobId: string; summary: GenerationJobSummary }) {
  const [detail, setDetail] = useState<GenerationJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .generationJob(jobId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) return <p className="error" style={{ padding: 16 }}>{error}</p>;
  if (!detail) return <p className="loading" style={{ padding: 16 }}>Loading job…</p>;

  return (
    <div style={{ padding: 16, display: "grid", gap: 20 }}>
      {summary.constraint && (
        <div>
          <SubLabel>Focus</SubLabel>
          <div style={{ fontSize: 14 }}>{summary.constraint}</div>
        </div>
      )}
      {detail.job.error_message && (
        <div style={{ color: "var(--danger)", fontSize: 13 }}>
          Error: {detail.job.error_message}
        </div>
      )}

      {(detail.source_documents.length > 0 || detail.uploaded_images.length > 0) && (
        <div>
          <SubLabel>Source worksheet</SubLabel>
          {detail.attachments && detail.attachments.selected > 0 && (
            <AttachmentUsage attachments={detail.attachments} />
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            {detail.source_documents.map((d) => (
              <DocumentThumb key={d.id} docId={d.id} filename={d.filename} fileType={d.file_type} />
            ))}
            {detail.uploaded_images.map((img) =>
              img.image_data ? (
                <ImageThumb
                  key={img.index}
                  src={`data:${img.media_type};base64,${img.image_data}`}
                  label={`page ${img.index + 1}`}
                />
              ) : (
                <div key={img.index} style={placeholderStyle}>
                  {img.media_type || "file"} (page {img.index + 1})
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <div>
        <SubLabel>Produced problems ({detail.items.length})</SubLabel>
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          {detail.items.length === 0 && (
            <span style={{ color: "#888", fontSize: 13 }}>No problems correlated to this job.</span>
          )}
          {detail.items.map((it, i) => (
            <div
              key={it.id}
              style={{
                border: "1px solid var(--rule)",
                borderRadius: 4,
                padding: 12,
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {i + 1}. {it.title || "Untitled"}
                </span>
                <span className="badge" style={statusBadgeStyle(it.status)}>{it.status}</span>
              </div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>{it.question}</div>
              {it.figure_svg && (
                <div
                  style={{ maxWidth: 220, margin: "6px 0" }}
                  // Geometry SVG rendered deterministically from the model's
                  // structured figure_spec (not raw model output); admin-only.
                  dangerouslySetInnerHTML={{ __html: it.figure_svg }}
                />
              )}
              {it.final_answer && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Answer: <span style={{ fontFamily: "var(--font-mono)" }}>{it.final_answer}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <SubLabel>LLM calls ({detail.llm_calls.length})</SubLabel>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {detail.llm_calls.length === 0 && (
            <span style={{ color: "#888", fontSize: 13 }}>No LLM calls correlated to this job.</span>
          )}
          {detail.llm_calls.map((c) => (
            <LLMCallRow key={c.id} c={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

// "Using M of N attached documents" — honest about what the model
// actually saw. When the MAX_VISION_IMAGES cap (or a non-image doc)
// dropped some of the teacher's selection, M < N and this warns.
function AttachmentUsage({ attachments }: { attachments: GenerationAttachments }) {
  const { used, selected, filenames } = attachments;
  const truncated = used < selected;
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 12,
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        flexWrap: "wrap",
        color: truncated ? "var(--danger)" : "var(--muted)",
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {truncated && "⚠ "}Using {used} of {selected} attached document
        {selected === 1 ? "" : "s"}
      </span>
      {truncated && (
        <span style={{ color: "var(--danger)" }}>
          — {selected - used} dropped by the vision-image cap
        </span>
      )}
      {filenames.length > 0 && (
        <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {filenames.join(", ")}
        </span>
      )}
    </div>
  );
}

function LLMCallRow({ c }: { c: GenerationJobDetail["llm_calls"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 4, background: "var(--surface)" }}>
      <div
        className="clickable"
        onClick={() => setOpen(!open)}
        style={{ display: "flex", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center" }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }}>{c.function}</span>
        <span style={{ color: "var(--muted)" }}>{c.model}</span>
        <span style={{ fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{fmtCost(c.cost_usd)}</span>
        <span style={{ color: "var(--muted-2)" }}>
          {c.input_tokens}→{c.output_tokens} tok
        </span>
        <span style={{ color: c.success ? "var(--ok)" : "var(--danger)" }}>
          {c.success ? "ok" : "fail"}
        </span>
        <span style={{ color: "var(--muted-2)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 12px 12px", display: "grid", gap: 8 }}>
          <div>
            <SubLabel>Input</SubLabel>
            <pre style={preStyle}>{c.input_text || "—"}</pre>
          </div>
          <div>
            <SubLabel>Output</SubLabel>
            <pre style={preStyle}>{c.output_text || "—"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentThumb({ docId, filename, fileType }: { docId: string; filename: string; fileType: string }) {
  const [doc, setDoc] = useState<DocumentContent | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .documentContent(docId)
      .then((d) => !cancelled && setDoc(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (error) return <div style={placeholderStyle}>{filename} (unavailable)</div>;
  if (!doc) return <div style={placeholderStyle}>Loading…</div>;
  if (!doc.image_data || !fileType.startsWith("image/")) {
    return <div style={placeholderStyle}>{filename} ({fileType})</div>;
  }
  return <ImageThumb src={`data:${doc.file_type};base64,${doc.image_data}`} label={filename} />;
}

function ImageThumb({ src, label }: { src: string; label: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" style={{ display: "block" }}>
      <img
        src={src}
        alt={label}
        style={{
          maxWidth: 200,
          maxHeight: 260,
          border: "1px solid var(--rule)",
          borderRadius: 4,
          display: "block",
          background: "var(--surface)",
        }}
      />
      <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{label}</span>
    </a>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: "var(--muted-2)",
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: "var(--paper-2)",
  borderRadius: 4,
  fontSize: 11,
  maxHeight: 220,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const placeholderStyle: React.CSSProperties = {
  width: 200,
  height: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px dashed var(--rule)",
  borderRadius: 4,
  fontSize: 12,
  color: "var(--muted-2)",
  textAlign: "center",
  padding: 8,
};

function shortId(id: string): string {
  return id.split("-")[0];
}

function metaSummary(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ·  ");
}

function actionBadgeStyle(action: string): React.CSSProperties {
  const family = action.split(".")[0];
  const map: Record<string, [string, string]> = {
    assignment: ["var(--info-soft)", "var(--info)"],
    generation: ["#efe3d0", "var(--accent)"],
    grade: ["#e6efe0", "var(--ok)"],
    bank_item: ["#efe3d0", "var(--accent)"],
    user: ["transparent", "var(--muted)"],
  };
  const [bg, color] = map[family] ?? ["transparent", "var(--muted)"];
  return { background: bg, color };
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    done: ["#e6efe0", "var(--ok)"],
    approved: ["#e6efe0", "var(--ok)"],
    running: ["var(--info-soft)", "var(--info)"],
    queued: ["var(--info-soft)", "var(--info)"],
    pending: ["transparent", "var(--muted)"],
    failed: ["#f3dcd8", "var(--danger)"],
    rejected: ["#f3dcd8", "var(--danger)"],
  };
  const [bg, color] = map[status] ?? ["transparent", "var(--muted)"];
  return { background: bg, color };
}
