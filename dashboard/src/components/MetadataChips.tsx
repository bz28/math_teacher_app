import { renderChipValue, shortId } from "../lib/format";

// Default keys we strip from the chip strip because we render them
// as their own promoted chips (school, submission). Pages can pass
// `extraSkipKeys` to drop additional keys that they already render
// in their own row header (e.g. SubmissionTrace shows posture in
// the row header so it skips it from the chip strip).
const DEFAULT_SKIP_KEYS = ["submission_id", "school_id"];

// Attached-document provenance keys (stamped by generation LLM calls,
// see api/core/document_vision.build_attachment_metadata). Rendered as
// one readable "Attached materials" chip instead of three raw chips so
// even the raw LLM-calls view is honest about what went into the model.
const ATTACHMENT_KEYS = [
  "attached_doc_filenames",
  "attached_docs_selected",
  "attached_docs_used",
];

function attachmentChipValue(
  metadata: Record<string, unknown>,
): string | null {
  if (!("attached_docs_selected" in metadata)) return null;
  const selected = Number(metadata.attached_docs_selected ?? 0);
  const used = Number(metadata.attached_docs_used ?? 0);
  const raw = metadata.attached_doc_filenames;
  const filenames = Array.isArray(raw) ? raw.map(String) : [];
  const names = filenames.length
    ? filenames.join(", ")
    : `${used} page${used === 1 ? "" : "s"}`;
  const count = used < selected ? `${used} of ${selected}` : `${selected}`;
  return `${names} (${count})`;
}

export interface MetadataChipsProps {
  metadata: Record<string, unknown> | null;
  /** Promoted school_id column. Null = the "internal" bucket. */
  schoolId?: string | null;
  /** Promoted submission_id column. */
  submissionId?: string | null;
  /** When set, the submission chip is clickable. Receives the id. */
  onSubmissionClick?: (id: string) => void;
  /** Additional metadata keys to suppress (already shown elsewhere). */
  extraSkipKeys?: string[];
  /** When true, the school/submission promoted chips are not rendered
   * (used by surfaces that show them at a higher visual level — e.g.
   * the flight recorder, which puts them in the page header). */
  hidePromoted?: boolean;
}

// Renders the metadata blob plus the promoted school_id / submission_id
// columns as a compact chip grid. The submission chip can be made
// clickable to deep-link into a filter; everything else is a read-
// only label.
export default function MetadataChips({
  metadata,
  schoolId,
  submissionId,
  onSubmissionClick,
  extraSkipKeys = [],
  hidePromoted = false,
}: MetadataChipsProps) {
  const skipKeys = new Set([...DEFAULT_SKIP_KEYS, ...ATTACHMENT_KEYS, ...extraSkipKeys]);
  const entries = metadata
    ? Object.entries(metadata).filter(([k]) => !skipKeys.has(k))
    : [];
  const attachments = metadata ? attachmentChipValue(metadata) : null;

  const showPromoted = !hidePromoted && (schoolId !== undefined || submissionId);
  if (!showPromoted && entries.length === 0 && attachments === null) {
    return <span className="metadata-empty">(none)</span>;
  }

  return (
    <div className="metadata-chips">
      {!hidePromoted && schoolId !== undefined && (
        schoolId ? (
          <Chip label="school" value={shortId(schoolId)} title={schoolId} />
        ) : (
          // school_id IS NULL = "Internal" bucket. Distinct pill so a
          // column of expanded rows scans cleanly and you can spot
          // the no-school calls at a glance.
          <span
            className="metadata-chip metadata-chip-internal"
            title="school_id IS NULL — founder, test, or non-school user"
          >
            🏷️ internal
          </span>
        )
      )}
      {!hidePromoted && submissionId && (
        <Chip
          label="submission"
          value={shortId(submissionId)}
          title={
            onSubmissionClick
              ? `Click to filter to this submission's calls\n${submissionId}`
              : submissionId
          }
          onClick={
            onSubmissionClick ? () => onSubmissionClick(submissionId) : undefined
          }
        />
      )}
      {attachments !== null && (
        <Chip label="Attached materials" value={attachments} />
      )}
      {entries.map(([k, v]) => (
        <Chip key={k} label={k} value={renderChipValue(v)} />
      ))}
    </div>
  );
}

interface ChipProps {
  label: string;
  value: string;
  title?: string;
  onClick?: () => void;
}

function Chip({ label, value, title, onClick }: ChipProps) {
  // 30-char visual cap with ellipsis — matches the CSS max-width so
  // we don't double-truncate.
  const truncated = value.length > 30 ? `${value.slice(0, 29)}…` : value;
  const className = `metadata-chip${onClick ? " metadata-chip-clickable" : ""}`;
  return (
    <span
      className={className}
      title={title ?? value}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="metadata-chip-label">{label}</span>
      <span className="metadata-chip-value">{truncated}</span>
    </span>
  );
}
