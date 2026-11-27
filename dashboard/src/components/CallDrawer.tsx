import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type LLMCallsData, type LLMPayload } from "../lib/api";
import { fmtCost, fmtLatency, formatRelativeDate, shortModel } from "../lib/format";
import MetadataChips from "./MetadataChips";
import StatusPill from "./StatusPill";

type CallRow = LLMCallsData["calls"][number];

/**
 * One call, beside the list it came from. A drawer rather than a modal so
 * the table stays in view: clicking down the rows reads each call in turn
 * without closing anything.
 *
 * It shows everything the call sent and got back — the error first when
 * it failed, then the system prompt and tool schema (fetched on open from
 * /admin/llm-payloads: they are large and shared by every call in a
 * class), the input, the output — and the two ways on: the submission's
 * case file, and the debugging agent.
 */
export default function CallDrawer({
  call, repo, debugState, onClose, onDebug, onSubmissionClick, onSessionClick,
}: {
  call: CallRow;
  repo: string;
  debugState: string | undefined;
  onClose: () => void;
  onDebug: () => void;
  onSubmissionClick: (id: string) => void;
  onSessionClick: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const who = [call.school_name, call.teacher_name, call.student_name].filter(Boolean).join(" · ");
  const status = call.success
    ? call.retry_count > 0 ? `OK · ${call.retry_count} ${call.retry_count === 1 ? "retry" : "retries"}` : "OK"
    : "Failed";

  return (
    <aside className="call-drawer" aria-label={`Call ${call.function}`}>
      <header className="call-drawer-head">
        <div>
          <div className="eyebrow">Call · {status}</div>
          <h2>{call.function}</h2>
        </div>
        <button type="button" className="call-drawer-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="llm-detail-title">
        <StatusPill tone={call.success ? "ok" : "danger"} label={call.success ? "OK" : "FAIL"} />
        <span className="llm-detail-meta" title={new Date(call.created_at).toLocaleString()}>
          {formatRelativeDate(call.created_at)}
        </span>
        <span className="llm-detail-meta" title={call.model}>{shortModel(call.model)}</span>
        <span className="llm-detail-meta">
          {call.input_tokens.toLocaleString()} → {call.output_tokens.toLocaleString()} tok
        </span>
        {(call.cache_read_tokens > 0 || call.cache_write_tokens > 0) && (
          <span
            className="llm-detail-meta"
            title={`Prompt cache: ${call.cache_read_tokens} read at 0.1x input, ${call.cache_write_tokens} written at 1.25x input`}
          >
            cache {call.cache_read_tokens}r/{call.cache_write_tokens}w
          </span>
        )}
        <span className="llm-detail-meta">{fmtLatency(call.latency_ms)}</span>
        <span className="llm-detail-meta">{fmtCost(call.cost_usd)}</span>
      </div>
      {who && <p className="call-drawer-who">{who}{call.deleted_submission && " · deleted submission"}</p>}

      <div className="llm-detail-actions">
        {call.submission_id && (
          <Link to={`/submissions/${call.submission_id}/trace`} className="llm-link-btn llm-link-primary">
            Open case file
          </Link>
        )}
        <button className="llm-link-btn" onClick={onDebug} disabled={debugState === "sending"}>
          Debug with agent
        </button>
        {(debugState === "sent" || Boolean(call.metadata?.debug_dispatched_at)) && (
          <a
            href={`https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:llm-debug ${call.id}`)}`}
            target="_blank" rel="noopener noreferrer" className="llm-link-btn"
            title="Open the debug agent's findings for this call on GitHub"
          >
            Debug results ↗
          </a>
        )}
        {call.session_id && (
          <button className="llm-link-btn" onClick={() => onSessionClick(call.session_id!)}>
            Session calls →
          </button>
        )}
      </div>
      {debugState === "sending" && <div className="llm-detail-note">Dispatching…</div>}
      {debugState === "sent" && <div className="llm-detail-note llm-note-ok">Dispatched — results appear under Debug results once the agent finishes.</div>}
      {debugState === "error" && <div className="llm-detail-note llm-note-bad">Dispatch failed (token configured?).</div>}

      <div className="llm-io">
        {!call.success && <TextBlock label="Error" text={call.output_text} />}
        <PayloadBlock label="System prompt" id={call.system_prompt_id} />
        <PayloadBlock label="Tool schema" id={call.tool_schema_id} />
        <TextBlock label="Input" text={call.input_text} />
        {call.success && <TextBlock label="Output" text={call.output_text} />}
      </div>

      <div className="llm-io-section">
        <strong>Metadata</strong>
        <MetadataChips
          metadata={call.metadata}
          schoolId={call.school_id}
          submissionId={call.submission_id}
          onSubmissionClick={onSubmissionClick}
        />
      </div>
    </aside>
  );
}

function TextBlock({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div className="llm-io-section">
      <div className="llm-io-head">
        <strong>{label}{note && <span className="llm-io-note"> · {note}</span>}</strong>
        <CopyButton text={text ?? ""} disabled={!text} />
      </div>
      <pre>{text || "(not captured)"}</pre>
    </div>
  );
}

/** A system prompt or tool schema: fetched when the call is opened, since
 *  one body serves a whole class of calls. `used_by` says how widely —
 *  a prompt used once where thirty were expected means something
 *  student-specific leaked into the cached half. */
function PayloadBlock({ label, id }: { label: string; id: string | null }) {
  const [loaded, setLoaded] = useState<{ id: string; payload: LLMPayload | null; error?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.llmPayload(id)
      .then((payload) => { if (!cancelled) setLoaded({ id, payload }); })
      .catch((e: Error) => { if (!cancelled) setLoaded({ id, payload: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [id]);

  if (!id) {
    return (
      <div className="llm-io-section">
        <div className="llm-io-head"><strong>{label}</strong></div>
        <pre className="llm-io-empty">(not recorded for this call)</pre>
      </div>
    );
  }
  const mine = loaded?.id === id ? loaded : null;
  if (!mine) {
    return (
      <div className="llm-io-section">
        <div className="llm-io-head"><strong>{label}</strong></div>
        <pre className="llm-io-empty">Loading…</pre>
      </div>
    );
  }
  if (!mine.payload) return <TextBlock label={label} text={null} note={mine.error ?? "failed to load"} />;
  const p = mine.payload;
  return (
    <TextBlock
      label={label}
      text={p.text}
      note={`used by ${p.used_by.toLocaleString()} call${p.used_by === 1 ? "" : "s"} · ${p.char_len.toLocaleString()} chars`}
    />
  );
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}
