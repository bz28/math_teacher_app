import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "katex/dist/katex.min.css";
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
import MathText from "./MathText";
import { Pagination } from "./Pagination";

// Wire pdf.js to its bundled worker. Vite fingerprints the worker via the
// `?url` import and serves it as a real asset, so the classic "fake worker"
// / worker-not-found breakage doesn't happen. Set once at module load.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
          <div style={{ fontSize: 14 }}>
            <MathText>{summary.constraint}</MathText>
          </div>
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
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <MathText>{it.question}</MathText>
              </div>
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
                  Answer: <MathText>{it.final_answer}</MathText>
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
// actually saw. When M < N some of the teacher's selection never
// reached the model — either the MAX_VISION_IMAGES cap truncated it
// or a doc wasn't a supported image (PDFs are filtered) — so warn.
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
          — {selected - used} not sent (over the image cap or not a supported image)
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
  if (!doc.image_data) {
    return <div style={placeholderStyle}>{filename} ({fileType})</div>;
  }
  if (fileType.startsWith("image/")) {
    return <ImageThumb src={`data:${doc.file_type};base64,${doc.image_data}`} label={filename} />;
  }
  if (fileType === "application/pdf") {
    return <PdfThumb b64={doc.image_data} label={filename} />;
  }
  return <div style={placeholderStyle}>{filename} ({fileType})</div>;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Render the first page of a stored PDF to a canvas thumbnail via pdf.js.
// Click opens the full document in a new tab — the browser's native PDF viewer
// gives the click-to-expand view for free, mirroring how ImageThumb links to
// its own full-size source. The link points at a blob: URL rather than a
// data: URL because Chrome blocks top-frame navigation to data: URLs (an
// anti-phishing measure), which silently swallowed a direct left-click.
function PdfThumb({ b64, label }: { b64: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(true);
  // Decode once per b64. atob() throws synchronously on malformed base64;
  // catching here (returning null) keeps the failure out of the effect so we
  // never call setState synchronously in it — the error is derived at render.
  const bytes = useMemo(() => {
    try {
      return base64ToBytes(b64);
    } catch {
      return null;
    }
  }, [b64]);

  // Build a blob: URL from the already-decoded bytes (no re-fetch) so a normal
  // left-click on the anchor opens the PDF. Chrome blocks top-frame navigation
  // to data: URLs, so a data: href silently swallowed the click — a blob: URL
  // navigates fine. Create it inside the effect and revoke in the same cleanup
  // so the URL that's live in the anchor is always the one this effect owns:
  // under StrictMode's mount→cleanup→mount, the remount recreates a fresh URL
  // rather than leaving the anchor pointing at a revoked one.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    // Syncing an external, non-render-safe resource (an object URL) into state;
    // runs once per decoded PDF, so it's not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdfUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPdfUrl(null);
    };
  }, [bytes]);

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    // pdf.js transfers ownership of the buffer to its worker, so hand it a
    // fresh copy each run — otherwise a re-run (e.g. StrictMode double-mount)
    // would get a detached buffer.
    const task = pdfjsLib.getDocument({ data: bytes.slice() });
    task.promise
      .then(async (pdf) => {
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        // Fit the first page into a ~200px-wide thumbnail, then upscale for
        // crisp rendering on high-DPI screens.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = (200 / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendering(false);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [bytes]);

  if (error || bytes === null)
    return <div style={placeholderStyle}>{label} (PDF preview failed)</div>;

  return (
    <a
      href={pdfUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "inline-block", cursor: pdfUrl ? "pointer" : "default" }}
    >
      <div
        style={{
          position: "relative",
          minWidth: rendering ? 200 : undefined,
          minHeight: rendering ? 120 : undefined,
          border: "1px solid var(--rule)",
          borderRadius: 4,
          background: "var(--surface)",
          overflow: "hidden",
        }}
      >
        {rendering && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: "var(--muted-2)",
            }}
          >
            Rendering PDF…
          </span>
        )}
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{label} (PDF)</span>
    </a>
  );
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
