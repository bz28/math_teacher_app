"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";

// ── Types ──

interface MaterialUnit {
  id: string;
  name: string;
  position: number;
}

interface MaterialDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  unit_id: string | null;
}

// ── Props ──

interface SectionInfo {
  id: string;
  name: string;
}

interface VisibilityState {
  hiddenUnits: Record<string, Set<string>>;
  hiddenDocs: Record<string, Set<string>>;
}

interface MaterialsTabProps {
  courseId: string;
  sections?: SectionInfo[];
  visibility?: VisibilityState;
  onToggleUnit?: (sectionId: string, unitId: string) => void;
  onToggleDoc?: (sectionId: string, docId: string) => void;
}

// ── Component ──

export function MaterialsTab({ courseId, sections = [], visibility, onToggleUnit, onToggleDoc }: MaterialsTabProps) {
  const [units, setUnits] = useState<MaterialUnit[]>([]);
  const [documents, setDocuments] = useState<MaterialDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());

  // Fetch real data from API
  const reload = useCallback(() => {
    Promise.all([
      teacher.units(courseId),
      teacher.documents(courseId),
    ]).then(([unitsRes, docsRes]) => {
      setUnits(unitsRes.units.map((u) => ({ id: u.id, name: u.name, position: u.position })));
      setDocuments(docsRes.documents.map((d) => ({
        id: d.id, filename: d.filename, file_type: d.file_type,
        file_size: d.file_size, unit_id: d.unit_id,
      })));
    }).finally(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { reload(); }, [reload]);

  // Unit CRUD state
  const [showCreateUnit, setShowCreateUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editUnitName, setEditUnitName] = useState("");

  const uncategorized = documents.filter((d) => d.unit_id === null);

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

  // Inline visibility panel state — which doc/unit has its panel expanded
  const [visExpanded, setVisExpanded] = useState<{ type: "unit" | "doc"; id: string } | null>(null);

  function toggleVisPanel(type: "unit" | "doc", id: string) {
    if (visExpanded?.type === type && visExpanded.id === id) {
      setVisExpanded(null);
    } else {
      setVisExpanded({ type, id });
    }
  }

  // Open doc visibility panel from the [...] menu
  function openDocVisFromMenu(docId: string) {
    setOpenDocMenu(null);
    setTimeout(() => setVisExpanded({ type: "doc", id: docId }), 50);
  }

  // Visibility helpers
  function getUnitVisibilityLabel(unitId: string): { text: string; color: "green" | "yellow" | "red" } {
    if (!visibility || sections.length === 0) return { text: "All sections", color: "green" };
    const hiddenFrom = sections.filter((s) => visibility.hiddenUnits[s.id]?.has(unitId));
    if (hiddenFrom.length === 0) return { text: "All sections", color: "green" };
    if (hiddenFrom.length === sections.length) return { text: "Hidden from all", color: "red" };
    return { text: `Hidden from: ${hiddenFrom.map((s) => s.name).join(", ")}`, color: "yellow" };
  }

  function getDocVisibilityLabel(docId: string, unitId: string | null): { text: string; color: "green" | "yellow" | "red" } | null {
    if (!visibility || sections.length === 0 || !unitId) return null;
    const hiddenFrom = sections.filter((s) => visibility.hiddenDocs[s.id]?.has(docId));
    if (hiddenFrom.length === 0) return null; // inherits from unit, no override
    if (hiddenFrom.length === sections.length) return { text: "Hidden from all sections", color: "red" };
    return { text: `Hidden from: ${hiddenFrom.map((s) => s.name).join(", ")}`, color: "yellow" };
  }

  // ── Error handling ──

  const [error, setError] = useState<string | null>(null);

  async function withErrorHandling(fn: () => Promise<void>) {
    try {
      setError(null);
      await fn();
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    }
  }

  // ── Unit CRUD ──

  async function handleCreateUnit() {
    const name = newUnitName.trim();
    if (!name) return;
    await withErrorHandling(async () => {
      await teacher.createUnit(courseId, name);
      setNewUnitName("");
      setShowCreateUnit(false);
      reload();
    });
  }

  async function handleRenameUnit(unitId: string) {
    const name = editUnitName.trim();
    if (!name) return;
    await withErrorHandling(async () => {
      await teacher.updateUnit(courseId, unitId, { name });
      setEditingUnitId(null);
      setEditUnitName("");
      reload();
    });
  }

  async function handleDeleteUnit(unitId: string) {
    await withErrorHandling(async () => {
      await teacher.deleteUnit(courseId, unitId);
      reload();
    });
  }

  // ── Document actions ──

  const [openDocMenu, setOpenDocMenu] = useState<string | null>(null);
  const [docMenuPos, setDocMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const docMenuRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function openDocMenuFor(docId: string, btnEl: HTMLButtonElement) {
    if (openDocMenu === docId) { setOpenDocMenu(null); return; }
    const rect = btnEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      setDocMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
    } else {
      setDocMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpenDocMenu(docId);
  }

  useEffect(() => {
    if (!openDocMenu) return;
    const close = () => setOpenDocMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openDocMenu]);

  async function handleMoveDoc(docId: string, targetUnitId: string | null) {
    await withErrorHandling(async () => {
      await teacher.updateDocument(courseId, docId, { unit_id: targetUnitId });
      setOpenDocMenu(null);
      reload();
    });
  }

  async function handleDeleteDoc(docId: string) {
    await withErrorHandling(async () => {
      await teacher.deleteDocument(courseId, docId);
      setOpenDocMenu(null);
      reload();
    });
  }

  // ── Upload modal ──

  const [showUpload, setShowUpload] = useState(false);
  const [uploadTargetUnit, setUploadTargetUnit] = useState<string | null | "top">(null); // null = uncategorized, "top" = show AI suggestions
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStep, setUploadStep] = useState<"pick" | "suggest">("pick");
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{ filename: string; docId: string; suggestedUnit: string; isNew: boolean; accepted: boolean }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openUploadModal(targetUnitId: string | null | "top") {
    setUploadTargetUnit(targetUnitId);
    setSelectedFiles([]);
    setUploadStep("pick");
    setAiSuggestions([]);
    setShowUpload(true);
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    setSelectedFiles(Array.from(files));
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;

    if (uploadTargetUnit === "top") {
      // Top-level upload: upload as uncategorized first, then ask AI to suggest units
      setUploadStep("suggest");
      setAiSuggesting(true);

      // Upload all files as uncategorized first
      let uploadResults: { filename: string; docId: string }[] = [];
      try {
        uploadResults = await Promise.all(selectedFiles.map(async (f) => {
          const base64 = await readFileAsBase64(f);
          const res = await teacher.uploadDocument(courseId, {
            image_base64: base64,
            filename: f.name,
            unit_id: null,
          });
          return { filename: f.name, docId: res.id };
        }));
      } catch {
        // Upload failed — close modal, reload to show any that did upload
        setShowUpload(false);
        setAiSuggesting(false);
        reload();
        return;
      }

      // Now suggest units with doc IDs so backend can read image content
      try {
        const docIds = uploadResults.map((r) => r.docId);
        const res = await teacher.suggestUnits(courseId, uploadResults.map((r) => r.filename), docIds);
        setAiSuggestions(res.suggestions.map((s) => {
          const uploaded = uploadResults.find((r) => r.filename === s.filename);
          return {
            filename: s.filename,
            docId: uploaded?.docId ?? "",
            suggestedUnit: s.suggested_unit,
            isNew: s.is_new,
            accepted: true,
          };
        }));
      } catch {
        // Suggest failed — show uploaded files as uncategorized with real doc IDs
        setAiSuggestions(uploadResults.map((r) => ({
          filename: r.filename,
          docId: r.docId,
          suggestedUnit: "Uncategorized",
          isNew: false,
          accepted: true,
        })));
      }
      setAiSuggesting(false);
    } else {
      // Direct upload to specific unit — parallel, single API call each
      await withErrorHandling(async () => {
        const unitId = uploadTargetUnit !== "top" ? uploadTargetUnit : null;
        await Promise.all(selectedFiles.map(async (f) => {
          const base64 = await readFileAsBase64(f);
          await teacher.uploadDocument(courseId, {
            image_base64: base64,
            filename: f.name,
            unit_id: unitId,
          });
        }));
        setShowUpload(false);
        reload();
      });
    }
  }

  async function handleConfirmSuggestions() {
    await withErrorHandling(async () => {
      // Create any new units that AI suggested
      const newUnitNames = [...new Set(
        aiSuggestions
          .filter((s) => s.accepted && s.isNew && s.suggestedUnit !== "Uncategorized")
          .map((s) => s.suggestedUnit),
      )];
      const createdUnits: Record<string, string> = {};
      for (const name of newUnitNames) {
        const res = await teacher.createUnit(courseId, name);
        createdUnits[name] = res.id;
      }

      // Move already-uploaded docs to their suggested units
      await Promise.all(aiSuggestions.filter((s) => s.accepted && s.docId).map(async (s) => {
        const unitId = s.suggestedUnit !== "Uncategorized"
          ? (units.find((u) => u.name === s.suggestedUnit)?.id ?? createdUnits[s.suggestedUnit] ?? null)
          : null;
        if (unitId) {
          await teacher.updateDocument(courseId, s.docId, { unit_id: unitId });
        }
      }));
      setShowUpload(false);
      reload();
    });
  }

  // ── AI auto-organize ──

  const [showAutoOrganize, setShowAutoOrganize] = useState(false);
  const [autoOrganizing, setAutoOrganizing] = useState(false);
  const [autoSuggestions, setAutoSuggestions] = useState<{ docId: string; filename: string; targetUnit: string; targetUnitId: string | null; isNew: boolean }[]>([]);

  async function handleAutoOrganize() {
    setShowAutoOrganize(true);
    setAutoOrganizing(true);

    try {
      const filenames = uncategorized.map((d) => d.filename);
      const docIds = uncategorized.map((d) => d.id);
      const res = await teacher.suggestUnits(courseId, filenames, docIds);

      const suggestions = uncategorized.map((doc) => {
        const match = res.suggestions.find((s) => s.filename === doc.filename);
        const suggestedName = match?.suggested_unit ?? "Keep Uncategorized";
        if (suggestedName === "Uncategorized" || suggestedName === "Keep Uncategorized") {
          return { docId: doc.id, filename: doc.filename, targetUnit: "Keep Uncategorized", targetUnitId: null, isNew: false };
        }
        const existingUnit = units.find((u) => u.name === suggestedName);
        return {
          docId: doc.id,
          filename: doc.filename,
          targetUnit: existingUnit?.name ?? suggestedName,
          targetUnitId: existingUnit?.id ?? null,
          isNew: !existingUnit && (match?.is_new ?? false),
        };
      });
      setAutoSuggestions(suggestions);
    } catch {
      // Fallback: keep everything uncategorized
      setAutoSuggestions(uncategorized.map((d) => ({
        docId: d.id, filename: d.filename,
        targetUnit: "Keep Uncategorized", targetUnitId: null, isNew: false,
      })));
    }
    setAutoOrganizing(false);
  }

  async function handleApplyAutoOrganize() {
    await withErrorHandling(async () => {
      // Create new units first
      const newUnitNames = [...new Set(
        autoSuggestions.filter((s) => s.isNew).map((s) => s.targetUnit),
      )];
      const createdUnits: Record<string, string> = {};
      for (const name of newUnitNames) {
        const created = await teacher.createUnit(courseId, name);
        createdUnits[name] = created.id;
      }

      // Move docs to their target units
      const updates = autoSuggestions.filter((s) => s.targetUnitId !== null || createdUnits[s.targetUnit]);
      await Promise.all(updates.map((u) =>
        teacher.updateDocument(courseId, u.docId, { unit_id: u.targetUnitId ?? createdUnits[u.targetUnit] })
      ));
      setShowAutoOrganize(false);
      reload();
    });
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
            onClick={() => openUploadModal("top")}
            className="flex items-center gap-1.5 rounded-[--radius-sm] bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
          >
            <UploadIcon />
            Upload
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-8 text-center text-sm text-text-muted">Loading materials...</div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between rounded-[--radius-md] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 font-semibold hover:underline">Dismiss</button>
        </div>
      )}

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
                <div className="flex items-center gap-2">
                  {/* Visibility badge (clickable) */}
                  {sections.length > 0 && (() => {
                    const vis = getUnitVisibilityLabel(unit.id);
                    const colorMap = {
                      green: "bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/10 dark:hover:bg-green-500/20",
                      yellow: "bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20",
                      red: "bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20",
                    };
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisPanel("unit", unit.id); }}
                        className={`hidden sm:inline-flex items-center gap-1 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-semibold transition-colors ${colorMap[vis.color]}`}
                      >
                        {vis.color === "green" ? <EyeIcon /> : <EyeOffIcon />}
                        {vis.text}
                      </button>
                    );
                  })()}
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
              </div>

              {/* Inline unit visibility panel */}
              {visExpanded?.type === "unit" && visExpanded.id === unit.id && onToggleUnit && visibility && sections.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border-t border-primary/20 bg-primary-bg/10 px-4 py-3"
                >
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Unit visibility by section</div>
                  <div className="space-y-1">
                    {sections.map((sec) => {
                      const isHidden = visibility.hiddenUnits[sec.id]?.has(unit.id);
                      return (
                        <button
                          key={sec.id}
                          onClick={() => onToggleUnit(sec.id, unit.id)}
                          className="flex w-full items-center justify-between rounded-[--radius-sm] px-3 py-2 text-xs transition-colors hover:bg-surface"
                        >
                          <span className="font-medium text-text-secondary">{sec.name}</span>
                          <span className={`flex items-center gap-1 rounded-[--radius-pill] px-2 py-0.5 font-semibold ${
                            !isHidden
                              ? "bg-green-50 text-green-600 dark:bg-green-500/10"
                              : "bg-red-50 text-red-500 dark:bg-red-500/10"
                          }`}>
                            {!isHidden ? <><EyeIcon /> Visible</> : <><EyeOffIcon /> Hidden</>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

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
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          units={units}
                          formatSize={formatSize}
                          openDocMenu={openDocMenu}
                          docMenuPos={docMenuPos}
                          onRegisterMenuRef={(docId, el) => { docMenuRefs.current[docId] = el; }}
                          onOpenMenu={openDocMenuFor}
                          onMove={handleMoveDoc}
                          onDelete={handleDeleteDoc}
                          visibilityLabel={getDocVisibilityLabel(doc.id, doc.unit_id)}
                          onVisClick={(docId) => openDocVisFromMenu(docId)}
                          visExpanded={visExpanded?.type === "doc" && visExpanded.id === doc.id}
                          sections={sections}
                          visibility={visibility}
                          onToggleDoc={onToggleDoc}
                        />
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => openUploadModal(unit.id)}
                    className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary hover:bg-primary-bg/30"
                  >
                    <UploadIcon />
                    Upload to this unit
                  </button>
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
              <div key={doc.id} className="rounded-[--radius-md] border border-border-light bg-surface">
                <DocRow
                  doc={doc}
                  units={units}
                  formatSize={formatSize}
                  openDocMenu={openDocMenu}
                  docMenuPos={docMenuPos}
                  onRegisterMenuRef={(docId, el) => { docMenuRefs.current[docId] = el; }}
                  onOpenMenu={openDocMenuFor}
                  onMove={handleMoveDoc}
                  onDelete={handleDeleteDoc}
                />
              </div>
            ))}
          </div>

          {/* AI auto-organize */}
          <button
            onClick={handleAutoOrganize}
            className="mt-3 flex items-center gap-1.5 rounded-[--radius-sm] border border-dashed border-primary/40 px-3 py-2 text-xs font-semibold text-primary hover:border-primary hover:bg-primary-bg/30"
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

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-4 w-full max-w-lg rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {uploadStep === "pick" && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-text-primary">Upload Documents</h3>
                  <button onClick={() => setShowUpload(false)} className="text-text-muted hover:text-text-secondary">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Drop zone */}
                <div
                  className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-[--radius-lg] border-2 border-dashed border-border py-10 transition-colors hover:border-primary hover:bg-primary-bg/20"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary", "bg-primary-bg/20"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("border-primary", "bg-primary-bg/20"); }}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-primary", "bg-primary-bg/20"); handleFilesSelected(e.dataTransfer.files); }}
                >
                  <UploadIcon />
                  <p className="mt-2 text-sm font-medium text-text-secondary">Drop files here or click to browse</p>
                  <p className="mt-1 text-xs text-text-muted">PDF, images, or documents</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />

                {/* Selected files */}
                {selectedFiles.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-text-muted">{selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected</div>
                    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                      {selectedFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <FileIcon />
                          <span className="text-text-primary">{f.name}</span>
                          <span className="text-xs text-text-muted">{formatSize(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {uploadTargetUnit !== "top" && uploadTargetUnit !== null && (
                  <div className="mt-3 text-xs text-text-muted">
                    Uploading to: <span className="font-semibold text-text-secondary">{units.find((u) => u.id === uploadTargetUnit)?.name}</span>
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-2">
                  <button onClick={() => setShowUpload(false)} className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50">
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={selectedFiles.length === 0}
                    className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadTargetUnit === "top" ? "Upload & Organize" : "Upload"}
                  </button>
                </div>
              </>
            )}

            {uploadStep === "suggest" && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-text-primary">AI Organization</h3>
                  <button onClick={() => setShowUpload(false)} className="text-text-muted hover:text-text-secondary">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>

                {aiSuggesting ? (
                  <div className="mt-8 flex flex-col items-center py-8">
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <SparkleIcon />
                      AI is organizing your files...
                    </div>
                    <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-border">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 1.5 }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-4 space-y-3">
                      {aiSuggestions.map((s, i) => (
                        <div key={i} className="rounded-[--radius-md] border border-border-light bg-primary-bg/20 p-3">
                          <div className="flex items-center gap-2">
                            <FileIcon />
                            <span className="text-sm font-medium text-text-primary">{s.filename}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="text-text-muted">Suggested:</span>
                            <span className="font-semibold text-primary">{s.suggestedUnit}</span>
                            {s.isNew && (
                              <span className="rounded-[--radius-pill] bg-green-50 px-1.5 py-0.5 text-[10px] font-bold text-green-600 dark:bg-green-500/10">New</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 flex justify-end gap-2">
                      <button onClick={() => setShowUpload(false)} className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50">
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmSuggestions}
                        className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
                      >
                        Accept All & Upload
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Auto-organize modal */}
      {showAutoOrganize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAutoOrganize(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-4 w-full max-w-lg rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">
                <span className="mr-2"><SparkleIcon /></span>
                AI Suggestions
              </h3>
              <button onClick={() => setShowAutoOrganize(false)} className="text-text-muted hover:text-text-secondary">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {autoOrganizing ? (
              <div className="mt-8 flex flex-col items-center py-8">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <SparkleIcon />
                  Analyzing your documents...
                </div>
                <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-border">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.5 }}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Group suggestions by target unit */}
                <div className="mt-4 space-y-4">
                  {(() => {
                    const grouped: Record<string, typeof autoSuggestions> = {};
                    for (const s of autoSuggestions) {
                      const key = s.targetUnit;
                      if (!grouped[key]) grouped[key] = [];
                      grouped[key].push(s);
                    }
                    return Object.entries(grouped).map(([unitName, docs]) => (
                      <div key={unitName}>
                        <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                          {unitName === "Keep Uncategorized" ? (
                            <span className="text-text-muted">Keep Uncategorized</span>
                          ) : (
                            <>
                              <FolderIcon />
                              Move to {unitName}
                            </>
                          )}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {docs.map((d) => (
                            <div key={d.docId} className="flex items-center gap-2 rounded-[--radius-sm] bg-primary-bg/20 px-3 py-1.5 text-sm">
                              <FileIcon />
                              <span className="text-text-primary">{d.filename}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <button onClick={() => setShowAutoOrganize(false)} className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50">
                    Cancel
                  </button>
                  <button
                    onClick={handleApplyAutoOrganize}
                    className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
                  >
                    Apply All
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ── DocRow with action menu ──

function DocRow({
  doc,
  units,
  formatSize,
  openDocMenu,
  docMenuPos,
  onRegisterMenuRef,
  onOpenMenu,
  onMove,
  onDelete,
  visibilityLabel,
  onVisClick,
  visExpanded,
  sections,
  visibility,
  onToggleDoc,
}: {
  doc: MaterialDocument;
  units: MaterialUnit[];
  formatSize: (bytes: number) => string;
  openDocMenu: string | null;
  docMenuPos: { top?: number; bottom?: number; right: number };
  onRegisterMenuRef: (docId: string, el: HTMLButtonElement | null) => void;
  onOpenMenu: (docId: string, btn: HTMLButtonElement) => void;
  onMove: (docId: string, unitId: string | null) => void;
  onDelete: (docId: string) => void;
  visibilityLabel?: { text: string; color: "green" | "yellow" | "red" } | null;
  onVisClick?: (docId: string) => void;
  visExpanded?: boolean;
  sections?: { id: string; name: string }[];
  visibility?: VisibilityState;
  onToggleDoc?: (sectionId: string, docId: string) => void;
}) {
  const moveTargets = [
    ...units.filter((u) => u.id !== doc.unit_id).map((u) => ({ id: u.id, label: u.name })),
    ...(doc.unit_id !== null ? [{ id: null as string | null, label: "Uncategorized" }] : []),
  ];

  return (
    <div>
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-primary-bg/20">
      <div className="flex items-center gap-2.5">
        <FileIcon />
        <div>
          <div className="text-sm font-medium text-text-primary">{doc.filename}</div>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span>{formatSize(doc.file_size)}</span>
            {visibilityLabel && (() => {
              const colorMap = {
                green: "text-green-600 hover:text-green-700",
                yellow: "text-amber-600 hover:text-amber-700",
                red: "text-red-500 hover:text-red-600",
              };
              return onVisClick ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onVisClick(doc.id); }}
                  className={`hidden sm:inline-flex items-center gap-0.5 cursor-pointer hover:underline ${colorMap[visibilityLabel.color]}`}
                >
                  {visibilityLabel.color !== "green" ? <EyeOffIcon /> : null}
                  {visibilityLabel.text}
                </button>
              ) : (
                <span className={`hidden sm:inline-flex items-center gap-0.5 ${colorMap[visibilityLabel.color]}`}>
                  {visibilityLabel.color !== "green" ? <EyeOffIcon /> : null}
                  {visibilityLabel.text}
                </span>
              );
            })()}
          </div>
        </div>
      </div>
      <div className="relative">
        <button
          ref={(el) => { onRegisterMenuRef(doc.id, el); }}
          onClick={(e) => { e.stopPropagation(); onOpenMenu(doc.id, e.currentTarget); }}
          className="rounded-[--radius-sm] p-1.5 text-text-muted hover:bg-primary-bg/50 hover:text-text-secondary"
        >
          <MoreIcon />
        </button>
        {openDocMenu === doc.id && (
          <div
            className="fixed z-50 min-w-[180px] rounded-[--radius-md] border border-border-light bg-surface py-1 shadow-lg"
            style={{
              ...(docMenuPos.top != null ? { top: docMenuPos.top } : {}),
              ...(docMenuPos.bottom != null ? { bottom: docMenuPos.bottom } : {}),
              right: docMenuPos.right,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {moveTargets.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Move to
                </div>
                {moveTargets.map((target) => (
                  <button
                    key={target.id ?? "uncat"}
                    onClick={() => onMove(doc.id, target.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-text-secondary hover:bg-primary-bg/50"
                  >
                    {target.id ? <FolderIcon /> : <span className="h-4 w-4" />}
                    {target.label}
                  </button>
                ))}
                <div className="my-1 border-t border-border-light" />
              </>
            )}
            {onVisClick && (
              <>
                <button
                  onClick={() => { onVisClick(doc.id); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-text-secondary hover:bg-primary-bg/50"
                >
                  <EyeIcon />
                  Visibility...
                </button>
                <div className="my-1 border-t border-border-light" />
              </>
            )}
            <button
              onClick={() => onDelete(doc.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <TrashIcon />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
    {/* Inline visibility panel */}
    {visExpanded && onToggleDoc && visibility && sections && sections.length > 0 && (
      <div className="border-t border-primary/20 bg-primary-bg/10 px-6 py-2.5">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Visibility by section</div>
        <div className="space-y-0.5">
          {sections.map((sec) => {
            const isHidden = visibility.hiddenDocs[sec.id]?.has(doc.id);
            return (
              <button
                key={sec.id}
                onClick={() => onToggleDoc(sec.id, doc.id)}
                className="flex w-full items-center justify-between rounded-[--radius-sm] px-2 py-1.5 text-xs transition-colors hover:bg-surface"
              >
                <span className="font-medium text-text-secondary">{sec.name}</span>
                <span className={`flex items-center gap-1 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-semibold ${
                  !isHidden
                    ? "bg-green-50 text-green-600 dark:bg-green-500/10"
                    : "bg-red-50 text-red-500 dark:bg-red-500/10"
                }`}>
                  {!isHidden ? <><EyeIcon /> Visible</> : <><EyeOffIcon /> Hidden</>}
                </span>
              </button>
            );
          })}
        </div>
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

function EyeIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
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
