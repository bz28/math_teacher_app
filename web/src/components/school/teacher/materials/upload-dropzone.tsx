"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { UploadIcon } from "@/components/ui/icons";

interface UploadDropzoneProps {
  busy: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

/**
 * Wraps the right pane and turns it into a drop target. Uses a counter to
 * track nested dragenter/leave events so the overlay doesn't flicker as the
 * pointer crosses child elements.
 */
export function UploadDropzone({ busy, onFiles, children }: UploadDropzoneProps) {
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragDepth(0);
    if (busy) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      className="relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <div
        aria-hidden={!isDragging}
        className={[
          "pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
          "rounded-[--radius-lg] bg-primary/5 backdrop-blur-sm",
          "ring-2 ring-inset ring-primary/40",
          "transition-opacity duration-200 ease-out",
          isDragging ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20">
            <UploadIcon className="h-7 w-7" strokeWidth={2.25} />
          </span>
          <div>
            <p className="text-base font-bold text-primary">Drop files to upload</p>
            <p className="mt-1 text-xs font-medium text-primary/70">
              PDF, PNG, JPG up to 25 MB
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
