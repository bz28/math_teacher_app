"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { TeacherDocument } from "@/lib/api";

// ── Mock data types ──

interface MockUnit {
  id: string;
  name: string;
  position: number;
}

interface MockDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  unit_id: string | null; // null = uncategorized
}

// ── Seed data (disappears on refresh) ──

const SEED_UNITS: MockUnit[] = [
  { id: "u1", name: "Unit 1: Linear Equations", position: 0 },
  { id: "u2", name: "Unit 2: Systems of Equations", position: 1 },
  { id: "u3", name: "Unit 3: Quadratic Equations", position: 2 },
];

const SEED_DOCS: MockDocument[] = [
  { id: "d1", filename: "Chapter 1 Notes.pdf", file_type: "application/pdf", file_size: 2_350_000, unit_id: "u1" },
  { id: "d2", filename: "Practice Problems Set A.pdf", file_type: "application/pdf", file_size: 1_100_000, unit_id: "u1" },
  { id: "d3", filename: "Answer Key.pdf", file_type: "application/pdf", file_size: 820_000, unit_id: "u1" },
  { id: "d4", filename: "Systems Overview.pdf", file_type: "application/pdf", file_size: 1_500_000, unit_id: "u2" },
  { id: "d5", filename: "Substitution Method HW.pdf", file_type: "application/pdf", file_size: 670_000, unit_id: "u2" },
  { id: "d6", filename: "Syllabus.pdf", file_type: "application/pdf", file_size: 120_000, unit_id: null },
  { id: "d7", filename: "Grading Rubric.pdf", file_type: "application/pdf", file_size: 85_000, unit_id: null },
];

// ── Props ──

interface MaterialsTabProps {
  realDocuments: TeacherDocument[];
  onDeleteDocument: (docId: string) => void;
}

// ── Component ──

export function MaterialsTab({ realDocuments, onDeleteDocument }: MaterialsTabProps) {
  // Use mock data (seed), ignore real documents for now
  const [units, setUnits] = useState<MockUnit[]>(SEED_UNITS);
  const [documents, setDocuments] = useState<MockDocument[]>(SEED_DOCS);
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());

  // Unit CRUD state
  const [showCreateUnit, setShowCreateUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editUnitName, setEditUnitName] = useState("");

  const uncategorized = documents.filter((d) => d.unit_id === null);
  let nextId = 100; // simple counter for mock IDs
  function mockId() { return `mock-${nextId++}-${Date.now()}`; }

  function toggleCollapse(unitId: string) {
    setCollapsedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

  function docsForUnit(unitId: string) {
    return documents.filter((d) => d.unit_id === unitId);
  }

  function formatSize(bytes: number) {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  // ── Unit CRUD ──

  function handleCreateUnit() {
    const name = newUnitName.trim();
    if (!name) return;
    const maxPos = units.reduce((max, u) => Math.max(max, u.position), -1);
    setUnits([...units, { id: mockId(), name, position: maxPos + 1 }]);
    setNewUnitName("");
    setShowCreateUnit(false);
  }

  function handleRenameUnit(unitId: string) {
    const name = editUnitName.trim();
    if (!name) return;
    setUnits(units.map((u) => u.id === unitId ? { ...u, name } : u));
    setEditingUnitId(null);
    setEditUnitName("");
  }

  function handleDeleteUnit(unitId: string) {
    // Move docs to uncategorized
    setDocuments(documents.map((d) => d.unit_id === unitId ? { ...d, unit_id: null } : d));
    setUnits(units.filter((u) => u.id !== unitId));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text-primary">Materials</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateUnit(true)}
            className="flex items-center gap-1.5 rounded-[--radius-sm] border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
          >
            + New Unit
          </button>
          <button
            disabled
            title="Coming in next commit"
            className="flex items-center gap-1.5 rounded-[--radius-sm] border border-border px-3 py-1.5 text-xs font-semibold text-text-muted opacity-50 cursor-not-allowed"
          >
            <UploadIcon />
            Upload
          </button>
        </div>
      </div>

      {/* Mock data notice */}
      <div className="rounded-[--radius-md] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
        Preview mode — using sample data. Changes reset on refresh.
      </div>

      {/* Create unit form */}
      {showCreateUnit && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[--radius-lg] border border-primary/30 bg-surface p-4"
        >
          <div className="text-sm font-semibold text-text-primary">New Unit</div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              placeholder="e.g. Unit 4: Polynomials"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateUnit(); if (e.key === "Escape") setShowCreateUnit(false); }}
              className="flex-1 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
            />
            <button
              onClick={handleCreateUnit}
              className="rounded-[--radius-sm] bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreateUnit(false); setNewUnitName(""); }}
              className="rounded-[--radius-sm] border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Units */}
      {units
        .sort((a, b) => a.position - b.position)
        .map((unit) => {
          const unitDocs = docsForUnit(unit.id);
          const isCollapsed = collapsedUnits.has(unit.id);

          return (
            <motion.div
              key={unit.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[--radius-lg] border border-border-light bg-surface"
            >
              {/* Unit header */}
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => toggleCollapse(unit.id)}
                  className="flex items-center gap-2 text-left"
                >
                  <svg
                    className={`h-4 w-4 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <FolderIcon />
                  {editingUnitId === unit.id ? (
                    <input
                      type="text"
                      value={editUnitName}
                      onChange={(e) => setEditUnitName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameUnit(unit.id);
                        if (e.key === "Escape") { setEditingUnitId(null); setEditUnitName(""); }
                      }}
                      onBlur={() => handleRenameUnit(unit.id)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-0.5 text-sm font-semibold text-text-primary outline-none"
                    />
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-text-primary">{unit.name}</span>
                      <span className="text-xs text-text-muted">
                        {unitDocs.length} file{unitDocs.length !== 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingUnitId(unit.id);
                      setEditUnitName(unit.name);
                    }}
                    title="Rename unit"
                    className="rounded-[--radius-sm] p-1.5 text-text-muted hover:bg-primary-bg/50 hover:text-primary"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${unit.name}"? Documents will be moved to Uncategorized.`)) {
                        handleDeleteUnit(unit.id);
                      }
                    }}
                    title="Delete unit"
                    className="rounded-[--radius-sm] p-1.5 text-text-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* Documents in unit */}
              {!isCollapsed && (
                <div className="border-t border-border-light">
                  {unitDocs.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-text-muted">
                      No documents in this unit yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-border-light">
                      {unitDocs.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between px-4 py-2.5 hover:bg-primary-bg/20"
                        >
                          <div className="flex items-center gap-2.5">
                            <FileIcon />
                            <div>
                              <div className="text-sm font-medium text-text-primary">{doc.filename}</div>
                              <div className="text-[11px] text-text-muted">{formatSize(doc.file_size)}</div>
                            </div>
                          </div>
                          <span className="text-xs text-text-muted">{formatSize(doc.file_size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}

      {/* Uncategorized section */}
      {uncategorized.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Uncategorized
            </span>
            <span className="text-xs text-text-muted">({uncategorized.length})</span>
          </div>
          <div className="space-y-1.5">
            {uncategorized.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-[--radius-md] border border-border-light bg-surface px-4 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <FileIcon />
                  <div>
                    <div className="text-sm font-medium text-text-primary">{doc.filename}</div>
                    <div className="text-[11px] text-text-muted">{formatSize(doc.file_size)}</div>
                  </div>
                </div>
                <span className="text-xs text-text-muted">{formatSize(doc.file_size)}</span>
              </div>
            ))}
          </div>

          {/* AI auto-organize placeholder */}
          <button
            disabled
            title="Coming soon"
            className="mt-3 flex items-center gap-1.5 rounded-[--radius-sm] border border-dashed border-border px-3 py-2 text-xs font-semibold text-text-muted opacity-50 cursor-not-allowed"
          >
            <SparkleIcon />
            Auto-organize with AI
          </button>
        </div>
      )}

      {/* Empty state (no units, no documents) */}
      {units.length === 0 && documents.length === 0 && (
        <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-bg/50 text-text-muted">
            <FolderIcon />
          </div>
          <p className="text-sm font-semibold text-text-primary">No materials yet</p>
          <p className="mt-1 text-xs text-text-muted">Create a unit and upload documents to get started.</p>
        </div>
      )}
    </div>
  );
}

// ── Icons ──

function FileIcon() {
  return (
    <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}
