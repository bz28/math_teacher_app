"use client";

import { memo, type MouseEvent } from "react";
import type { TeacherDocument } from "@/lib/api";
import { FileTextIcon, ImageIcon } from "@/components/ui/icons";
import { formatDate, formatFileSize } from "@/lib/utils";
import { fileKind } from "./types";

interface FileGridProps {
  docs: TeacherDocument[];
  selectedIds: Set<string>;
  onCardClick: (doc: TeacherDocument, e: MouseEvent) => void;
  onPreview: (doc: TeacherDocument) => void;
}

export function FileGrid({ docs, selectedIds, onCardClick, onPreview }: FileGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {docs.map((d) => (
        <FileCard
          key={d.id}
          doc={d}
          selected={selectedIds.has(d.id)}
          onCardClick={onCardClick}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

interface FileCardProps {
  doc: TeacherDocument;
  selected: boolean;
  onCardClick: (doc: TeacherDocument, e: MouseEvent) => void;
  onPreview: (doc: TeacherDocument) => void;
}

const KIND_STYLES = {
  pdf: {
    wash: "bg-red-50/60 dark:bg-red-500/[0.06]",
    washSelected: "bg-red-50 dark:bg-red-500/10",
    badge: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300",
  },
  image: {
    wash: "bg-blue-50/60 dark:bg-blue-500/[0.06]",
    washSelected: "bg-blue-50 dark:bg-blue-500/10",
    badge: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300",
  },
} as const;

const FileCard = memo(function FileCard({ doc, selected, onCardClick, onPreview }: FileCardProps) {
  const kind = fileKind(doc);
  const date = formatDate(doc.created_at, { alwaysYear: true });
  const styles = KIND_STYLES[kind];

  return (
    <button
      type="button"
      onClick={(e) => onCardClick(doc, e)}
      onDoubleClick={(e) => {
        e.preventDefault();
        onPreview(doc);
      }}
      aria-pressed={selected}
      title="Click to select · Double-click to preview"
      className={[
        "group/card relative flex items-start gap-3 rounded-[--radius-md] border p-3 text-left text-xs",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        selected
          ? `border-primary ${styles.washSelected} ring-2 ring-primary shadow-sm`
          : `border-border-light ${styles.wash} hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md`,
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-sm]",
          "transition-colors duration-200",
          styles.badge,
        ].join(" ")}
        aria-hidden
      >
        {kind === "pdf" ? (
          <FileTextIcon className="h-5 w-5" strokeWidth={2.25} />
        ) : (
          <ImageIcon className="h-5 w-5" strokeWidth={2.25} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="line-clamp-2 break-words text-[13px] font-semibold leading-tight tracking-tight text-text-primary"
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div className="mt-1.5 text-[11px] font-medium text-text-muted">
          {formatFileSize(doc.file_size)}
          {date && <span> · {date}</span>}
        </div>
      </div>
      {/* Hover-only preview affordance — double-click also works but isn't
          discoverable, especially on touch devices where hover maps to long-
          press. Rendered as <span> with onClick, not <button>, so it
          doesn't nest inside the outer <button> (invalid HTML). */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onPreview(doc);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onPreview(doc);
          }
        }}
        aria-label={`Preview ${doc.filename}`}
        className="absolute right-1.5 top-1.5 rounded-[--radius-sm] bg-surface/90 px-1.5 py-0.5 text-[10px] font-bold text-text-secondary opacity-0 shadow-sm ring-1 ring-border-light backdrop-blur-sm transition-opacity hover:text-primary group-hover/card:opacity-100 focus-visible:opacity-100"
      >
        View
      </span>
    </button>
  );
});
