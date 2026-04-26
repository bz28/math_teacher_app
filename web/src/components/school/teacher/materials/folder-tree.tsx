"use client";

import { useEffect, useRef, useState } from "react";
import type { TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";
import {
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  XIcon,
} from "@/components/ui/icons";
import type { RowState } from "./types";

interface FolderTreeProps {
  units: TeacherUnit[];
  selected: string | null;
  docCountFor: (unitId: string) => number;
  rowState: RowState;
  busy: boolean;
  onSelect: (unitId: string) => void;
  onStartRename: (id: string) => void;
  onSubmitRename: (unit: TeacherUnit, name: string) => void;
  onCancelRow: () => void;
  onStartDeleteFolder: (id: string) => void;
  onAddSub: (parentId: string | null) => void;
}

export function FolderTree({
  units,
  selected,
  docCountFor,
  rowState,
  busy,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRow,
  onStartDeleteFolder,
  onAddSub,
}: FolderTreeProps) {
  const tops = topUnits(units);

  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-3 shadow-sm">
      {tops.length === 0 && (
        <p className="px-2 py-2 text-xs text-text-muted">No units yet.</p>
      )}
      <ul className="space-y-1">
        {tops.map((u) => {
          const subs = subfoldersOf(units, u.id);
          return (
          <li key={u.id}>
            <FolderRow
              unit={u}
              selected={selected === u.id}
              docCount={docCountFor(u.id)}
              rowState={rowState}
              busy={busy}
              onSelect={() => onSelect(u.id)}
              onStartRename={() => onStartRename(u.id)}
              onSubmitRename={(name) => onSubmitRename(u, name)}
              onCancelRow={onCancelRow}
              onStartDelete={() => onStartDeleteFolder(u.id)}
              onAddSub={() => onAddSub(u.id)}
            />
            {subs.length > 0 && (
              <ul className="ml-4 mt-1 space-y-1 border-l border-border-light pl-2">
                {subs.map((sub) => (
                  <li key={sub.id}>
                    <FolderRow
                      unit={sub}
                      selected={selected === sub.id}
                      docCount={docCountFor(sub.id)}
                      rowState={rowState}
                      busy={busy}
                      onSelect={() => onSelect(sub.id)}
                      onStartRename={() => onStartRename(sub.id)}
                      onSubmitRename={(name) => onSubmitRename(sub, name)}
                      onCancelRow={onCancelRow}
                      onStartDelete={() => onStartDeleteFolder(sub.id)}
                      isSub
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

interface FolderRowProps {
  unit: TeacherUnit;
  selected: boolean;
  docCount: number;
  rowState: RowState;
  busy: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (name: string) => void;
  onCancelRow: () => void;
  onStartDelete: () => void;
  onAddSub?: () => void;
  isSub?: boolean;
}

function FolderRow({
  unit,
  selected,
  docCount,
  rowState,
  busy,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRow,
  onStartDelete,
  onAddSub,
  isSub,
}: FolderRowProps) {
  const isRenaming = rowState.kind === "renaming" && rowState.id === unit.id;

  if (isRenaming) {
    return (
      <RenameForm
        initialName={unit.name}
        isSub={isSub}
        busy={busy}
        onSubmit={onSubmitRename}
        onCancel={onCancelRow}
      />
    );
  }

  return (
    <div
      className={`group/row relative flex items-center gap-1 rounded-[--radius-sm] px-2 py-2 transition-colors duration-150 ease-out ${
        selected ? "bg-primary-bg" : "hover:bg-bg-subtle"
      }`}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-primary"
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        className={`flex flex-1 items-center gap-2 truncate text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-none ${
          selected ? "font-semibold text-primary" : "text-text-secondary"
        }`}
      >
        {selected && !isSub ? (
          <FolderOpenIcon
            className={`h-4 w-4 shrink-0 transition-colors ${
              selected ? "text-primary" : "text-text-muted"
            }`}
          />
        ) : (
          <FolderIcon
            className={`h-4 w-4 shrink-0 transition-colors ${
              selected ? "text-primary" : "text-text-muted"
            }`}
          />
        )}
        <span className="truncate">{unit.name}</span>
        <CountPill active={selected} count={docCount} />
      </button>
      <RowMenu
        onRename={onStartRename}
        onAddSub={onAddSub}
        onDelete={onStartDelete}
        disabled={busy}
      />
    </div>
  );
}


function CountPill({ active, count }: { active: boolean; count: number }) {
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors duration-150 ease-out ${
        active
          ? "bg-primary text-white"
          : "bg-bg-subtle text-text-muted group-hover/row:bg-surface"
      }`}
    >
      {count}
    </span>
  );
}

function RowMenu({
  onRename,
  onAddSub,
  onDelete,
  disabled,
}: {
  onRename: () => void;
  onAddSub?: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Folder actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`rounded p-1 text-text-muted opacity-0 transition group-hover/row:opacity-100 hover:bg-surface hover:text-text-primary focus:opacity-100 disabled:opacity-50 ${
          open ? "opacity-100" : ""
        }`}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-[--radius-md] border border-border-light bg-surface py-1 text-xs shadow-lg"
        >
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rename
          </MenuItem>
          {onAddSub && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onAddSub();
              }}
            >
              <PlusIcon className="h-3 w-3" />
              New subfolder
            </MenuItem>
          )}
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
          : "text-text-secondary hover:bg-bg-subtle"
      }`}
    >
      {children}
    </button>
  );
}

function RenameForm({
  initialName,
  isSub,
  busy,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  isSub?: boolean;
  busy: boolean;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialName);
  return (
    <form
      className="flex items-center gap-1 rounded-[--radius-sm] bg-primary-bg/40 px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      {isSub ? (
        <FolderOpenIcon className="h-4 w-4 shrink-0 text-text-muted" />
      ) : (
        <FolderIcon className="h-4 w-4 shrink-0 text-text-muted" />
      )}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        maxLength={200}
        aria-label="Folder name"
        className="flex-1 rounded-[--radius-sm] border border-border-light bg-bg-base px-1.5 py-0.5 text-sm text-text-primary focus:border-primary focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded px-1.5 py-0.5 text-xs font-bold text-primary hover:bg-surface disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel rename"
        className="rounded px-1.5 py-0.5 text-text-muted hover:bg-surface"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </form>
  );
}
