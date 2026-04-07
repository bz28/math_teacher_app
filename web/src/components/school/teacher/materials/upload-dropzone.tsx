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
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[--radius-lg] border-2 border-dashed border-primary bg-primary-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-primary">
            <UploadIcon className="h-8 w-8" />
            <p className="text-sm font-bold">Drop files to upload</p>
          </div>
        </div>
      )}
    </div>
  );
}
