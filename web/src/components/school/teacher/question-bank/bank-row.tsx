"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { teacher, type BankItem } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { CourseSubjectContext } from "./course-subject-context";
import { conceptEmoji } from "./concept-emoji";
import { DIFFICULTY_STYLE } from "./constants";

// Dense one-line row. Status dot, truncated question, Used-in pills,
// optional unit label, lock badge, kebab menu. Click the question text
// to open the workshop modal. The `variation` flag styles it slightly
// smaller + no border so it nests visually under its parent.
export function BankRow({
  item,
  unitLabel,
  showUnit,
  variation = false,
  onOpen,
  onOpenHomework,
  onChanged,
}: {
  item: BankItem;
  unitLabel: string;
  showUnit: boolean;
  variation?: boolean;
  onOpen: () => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const { busy, error, run } = useAsyncAction();

  const dotClass =
    item.status === "approved"
      ? "bg-green-500"
      : item.status === "pending"
        ? "bg-amber-400"
        : "bg-text-muted/40";

  const approve = () =>
    run(async () => {
      await teacher.approveBankItem(item.id);
      onChanged();
    });
  const reject = () =>
    run(async () => {
      await teacher.rejectBankItem(item.id);
      onChanged();
    });
  const remove = () =>
    run(async () => {
      await teacher.deleteBankItem(item.id);
      onChanged();
    });

  return (
    <div
      className={`flex items-start gap-3 px-3 transition-all hover:-translate-y-px hover:bg-bg-subtle hover:shadow-sm ${
        variation ? "py-1.5 text-xs" : "py-3 text-sm"
      } ${item.status === "rejected" ? "opacity-60" : ""}`}
    >
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`}
        title={item.status}
        aria-label={item.status}
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left text-text-primary hover:text-primary"
          title={item.question}
        >
          <div className="flex items-center gap-2 truncate">
            <span className="shrink-0" aria-hidden>
              {conceptEmoji(item.title, item.question, useContext(CourseSubjectContext))}
            </span>
            {item.source === "practice" && (
              <span className="shrink-0 text-purple-500" title="Practice variation">✨</span>
            )}
            <span className="truncate font-semibold">{item.title}</span>
          </div>
        </button>
        {/* Mobile: pills + unit label wrap below the question text on
            narrow screens. Desktop renders them on the right. Lives
            outside the question button so the nested-button is valid. */}
        {(showUnit || item.used_in.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-text-muted sm:hidden">
            {showUnit && <span>📁 {unitLabel}</span>}
            {item.used_in.map((u) => (
              <UsedInPill
                key={u.id}
                entry={u}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenHomework(u.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: pills sit to the right of the question text */}
      {item.used_in.length > 0 && (
        <div className="hidden shrink-0 flex-wrap items-center gap-1 pt-0.5 sm:flex">
          {item.used_in.map((u) => (
            <UsedInPill
              key={u.id}
              entry={u}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHomework(u.id);
              }}
            />
          ))}
        </div>
      )}

      {DIFFICULTY_STYLE[item.difficulty] && (
        <span
          className={`hidden shrink-0 rounded-[--radius-pill] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:inline ${DIFFICULTY_STYLE[item.difficulty].cls}`}
        >
          {DIFFICULTY_STYLE[item.difficulty].label}
        </span>
      )}

      {item.locked && (
        <span
          className="shrink-0 pt-0.5 text-amber-600 dark:text-amber-400"
          title="Locked — in published homework"
        >
          🔒
        </span>
      )}

      <KebabMenu
        item={item}
        busy={busy}
        onApprove={approve}
        onReject={reject}
        onRemove={remove}
      />

      {error && (
        <span className="shrink-0 pt-0.5 text-[10px] text-red-600" title={error}>
          ⚠
        </span>
      )}
    </div>
  );
}

// Pill rendering for "used in" entries. Visually distinguishes
// homework vs test, and draft vs published, so a teacher building a
// new homework can tell at a glance which references are live.
function UsedInPill({
  entry,
  onClick,
}: {
  entry: { id: string; title: string; type: string; status: string };
  onClick: (e: React.MouseEvent) => void;
}) {
  const isTest = entry.type === "test" || entry.type === "quiz";
  const isDraft = entry.status !== "published";
  const colorClass = isDraft
    ? "border border-dashed border-text-muted/40 bg-transparent text-text-muted hover:bg-bg-subtle"
    : isTest
      ? "bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300"
      : "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[10px] font-bold transition-colors ${colorClass}`}
      title={`Open ${entry.title}${isDraft ? " (draft)" : ""}`}
    >
      {entry.title}
      {isDraft && <span className="ml-1 opacity-70">draft</span>}
    </button>
  );
}

// Action menu — three dots that opens a small dropdown. Replaces the
// always-visible Approve/Reject/Delete row of buttons. Uses a window
// click listener for outside-click dismiss.
function KebabMenu({
  item,
  busy,
  onApprove,
  onReject,
  onRemove,
}: {
  item: BankItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const lockedTitle = item.locked ? "Locked by published homework" : undefined;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
        aria-label="Actions"
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-40 rounded-[--radius-md] border border-border-light bg-surface py-1 text-xs shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {item.status === "pending" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-green-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              ✓ Approve
            </button>
          )}
          {item.status !== "rejected" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReject();
              }}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              ✕ Reject
            </button>
          )}
          {item.status === "rejected" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
              disabled={busy}
              className="block w-full px-3 py-1.5 text-left font-semibold text-green-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              ↺ Restore
            </button>
          )}
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmDelete(false);
                onRemove();
              }}
              disabled={busy}
              className="block w-full px-3 py-1.5 text-left font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Yes, delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-red-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
