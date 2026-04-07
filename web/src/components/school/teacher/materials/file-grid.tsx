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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group/card flex items-start gap-2 rounded-[--radius-md] border bg-bg-subtle p-3 text-left text-xs transition-all ${
        selected
          ? "border-primary bg-primary-bg ring-2 ring-primary/30"
          : "border-border-light hover:border-border-strong hover:bg-surface"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[--radius-sm] ${
          kind === "pdf"
            ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300"
            : "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
        }`}
      >
        {kind === "pdf" ? (
          <FileTextIcon className="h-5 w-5" strokeWidth={2.25} />
        ) : (
          <ImageIcon className="h-5 w-5" strokeWidth={2.25} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="line-clamp-2 break-words font-semibold text-text-primary"
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div className="mt-1 text-[11px] text-text-muted">
          {formatSize(doc.file_size)}
          {date && <span> · {date}</span>}
        </div>
      </div>
    </button>
  );
}
