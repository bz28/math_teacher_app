"use client";

import { useState } from "react";
import { motion } from "framer-motion";

// ── Types (shared with materials-tab) ──

export interface MaterialUnit {
  id: string;
  name: string;
  position: number;
}

export interface MaterialDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  unit_id: string | null;
}

// Visibility state: sectionId → Set of hidden unitIds or docIds
export interface VisibilityState {
  hiddenUnits: Record<string, Set<string>>; // sectionId → Set<unitId>
  hiddenDocs: Record<string, Set<string>>;  // sectionId → Set<docId>
}

// ── Props ──

interface SectionMaterialsProps {
  sectionId: string;
  sectionName: string;
  units: MaterialUnit[];
  documents: MaterialDocument[];
  visibility: VisibilityState;
  onToggleUnit: (sectionId: string, unitId: string) => void;
  onToggleDoc: (sectionId: string, docId: string) => void;
}

// ── Component ──

export function SectionMaterials({
  sectionId,
  sectionName,
  units,
  documents,
  visibility,
  onToggleUnit,
  onToggleDoc,
}: SectionMaterialsProps) {
  const hiddenUnitSet = visibility.hiddenUnits[sectionId] ?? new Set();
  const hiddenDocSet = visibility.hiddenDocs[sectionId] ?? new Set();

  function isUnitVisible(unitId: string) {
    return !hiddenUnitSet.has(unitId);
  }

  function isDocVisible(docId: string, unitId: string | null) {
    // If unit is hidden, doc is hidden regardless
    if (unitId && hiddenUnitSet.has(unitId)) return false;
    return !hiddenDocSet.has(docId);
  }

  function docsForUnit(unitId: string) {
    return documents.filter((d) => d.unit_id === unitId);
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-text-muted">
        Control which materials <span className="font-semibold text-text-secondary">{sectionName}</span> students can see.
      </div>

      {units
        .sort((a, b) => a.position - b.position)
        .map((unit) => {
          const unitVisible = isUnitVisible(unit.id);
          const unitDocs = docsForUnit(unit.id);

          return (
            <div
              key={unit.id}
              className={`rounded-[--radius-md] border p-3 transition-colors ${
                unitVisible ? "border-border-light bg-surface" : "border-border bg-surface/50 opacity-60"
              }`}
            >
              {/* Unit row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderIcon />
                  <span className={`text-sm font-semibold ${unitVisible ? "text-text-primary" : "text-text-muted line-through"}`}>
                    {unit.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    {unitDocs.length} file{unitDocs.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => onToggleUnit(sectionId, unit.id)}
                  className={`flex items-center gap-1.5 rounded-[--radius-pill] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    unitVisible
                      ? "bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/10 dark:hover:bg-green-500/20"
                      : "bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20"
                  }`}
                >
                  {unitVisible ? (
                    <>
                      <EyeIcon />
                      Visible
                    </>
                  ) : (
                    <>
                      <EyeOffIcon />
                      Hidden
                    </>
                  )}
                </button>
              </div>

              {/* Individual docs (only show if unit is visible) */}
              {unitVisible && unitDocs.length > 0 && (
                <div className="mt-2 space-y-1 pl-6">
                  {unitDocs.map((doc) => {
                    const docVisible = isDocVisible(doc.id, doc.unit_id);
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-[--radius-sm] px-2 py-1"
                      >
                        <div className="flex items-center gap-2">
                          <FileIcon />
                          <span className={`text-xs ${docVisible ? "text-text-secondary" : "text-text-muted line-through"}`}>
                            {doc.filename}
                          </span>
                        </div>
                        <button
                          onClick={() => onToggleDoc(sectionId, doc.id)}
                          className={`rounded-[--radius-sm] px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                            docVisible
                              ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10"
                              : "text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                          }`}
                        >
                          {docVisible ? <EyeIcon /> : <EyeOffIcon />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* If unit hidden, show message */}
              {!unitVisible && (
                <div className="mt-1 pl-6 text-[11px] text-text-muted">
                  All files hidden — unit is off for this section.
                </div>
              )}
            </div>
          );
        })}

      {/* Uncategorized */}
      {documents.filter((d) => d.unit_id === null).length > 0 && (
        <div className="rounded-[--radius-md] border border-border-light bg-surface p-3">
          <div className="text-xs font-semibold text-text-muted">Uncategorized — always visible</div>
          <div className="mt-1.5 space-y-1 pl-2">
            {documents
              .filter((d) => d.unit_id === null)
              .map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 py-0.5">
                  <FileIcon />
                  <span className="text-xs text-text-secondary">{doc.filename}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icons ──

function FolderIcon() {
  return (
    <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
