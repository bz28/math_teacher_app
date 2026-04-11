"use client";

import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { EditProblemTextarea } from "./edit-problem-textarea";
import { MathText } from "./math-text";
import type { ImageExtractResponse } from "@/lib/api";

interface ExtractionResultModalProps {
  result: ImageExtractResponse | null;
  selected: boolean[];
  editingIndex: number | null;
  onToggle: (index: number) => void;
  onUpdateText: (index: number, text: string) => void;
  onSetEditingIndex: (index: number | null) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Bottom-sheet-style modal showing the extracted problems with inline edit.
 *
 * Pure render — state is owned by `useImageExtraction`.
 */
export function ExtractionResultModal({
  result,
  selected,
  editingIndex,
  onToggle,
  onUpdateText,
  onSetEditingIndex,
  onConfirm,
  onClose,
}: ExtractionResultModalProps) {
  const selectedCount = selected.filter(Boolean).length;

  return (
    <Modal open={!!result} onClose={onClose} dismissible={editingIndex === null}>
      {result && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Got it — confirm</h2>
            <p className="text-sm text-text-secondary">
              Found {result.problems.length} problem{result.problems.length !== 1 && "s"}.
              Review, edit, and add.
            </p>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {result.problems.map((problem, i) => {
              const isEditing = editingIndex === i;
              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-[--radius-md] border p-3 transition-colors",
                    selected[i] ? "border-primary bg-primary-bg/50" : "border-border-light",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {isEditing ? (
                      <>
                        <input
                          type="checkbox"
                          checked={selected[i]}
                          onChange={() => onToggle(i)}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                          aria-label={`Include problem ${i + 1}`}
                        />
                        <div className="min-w-0 flex-1">
                          <EditProblemTextarea
                            value={problem}
                            onChange={(text) => onUpdateText(i, text)}
                            onDone={() => onSetEditingIndex(null)}
                          />
                        </div>
                      </>
                    ) : (
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected[i]}
                          onChange={() => onToggle(i)}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                          aria-label={`Include problem ${i + 1}`}
                        />
                        <span className="min-w-0 flex-1 text-sm text-text-primary">
                          <MathText text={problem} />
                        </span>
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => onSetEditingIndex(isEditing ? null : i)}
                      aria-label={isEditing ? "Finish editing problem" : "Edit problem"}
                      className="flex-shrink-0 rounded-[--radius-sm] px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-primary-bg hover:text-primary"
                    >
                      {isEditing ? "Done" : "Edit"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button gradient onClick={onConfirm} disabled={selectedCount === 0}>
              Add {selectedCount} Problem{selectedCount !== 1 && "s"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
