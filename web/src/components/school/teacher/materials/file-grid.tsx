"use client";

import type { MouseEvent } from "react";
import type { TeacherDocument } from "@/lib/api";
import { FileTextIcon, ImageIcon } from "@/components/ui/icons";
import { fileKind, formatDate, formatSize } from "./types";

interface FileGridProps {
  docs: TeacherDocument[];
  selectedIds: Set<string>;
  onCardClick: (doc: TeacherDocument, e: MouseEvent) => void;
}

export function FileGrid({ docs, selectedIds, onCardClick }: FileGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {docs.map((d) => (
        <FileCard
          key={d.id}
          doc={d}
          selected={selectedIds.has(d.id)}
          onClick={(e) => onCardClick(d, e)}
        />
      ))}
    </div>
  );
}

interface FileCardProps {
  doc: TeacherDocument;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
}

function FileCard({ doc, selected, onClick }: FileCardProps) {
  const kind = fileKind(doc);
  const date = formatDate(doc.created_at);

  // Soft per-type wash (very subtle on default, slightly stronger when selected).
  const wash =
    kind === "pdf"
      ? "bg-red-50/60 dark:bg-red-500/[0.06]"
      : "bg-blue-50/60 dark:bg-blue-500/[0.06]";
  const washSelected =
    kind === "pdf"
      ? "bg-red-50 dark:bg-red-500/10"
      : "bg-blue-50 dark:bg-blue-500/10";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "group/card relative flex items-start gap-3 rounded-[--radius-md] border p-3 text-left text-xs",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        selected
          ? `border-primary ${washSelected} ring-2 ring-primary shadow-sm`
          : `border-border-light ${wash} hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md`,
      ].join(" ")}
    >
      <span
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-sm]",
          "transition-colors duration-200",
          kind === "pdf"
            ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
            : "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300",
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
          {formatSize(doc.file_size)}
          {date && <span> · {date}</span>}
        </div>
      </div>
    </button>
  );
}
