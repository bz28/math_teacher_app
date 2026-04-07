/**
 * Unit hierarchy helpers — shared across the teacher portal so the same
 * "top units + subfolders" navigation logic isn't duplicated in every
 * tab. The model is two levels deep: top-level units and direct
 * subfolders. Anything else is treated as a top unit.
 */

import type { TeacherUnit } from "@/lib/api";

/** Top-level units (parent_id === null) in their stored order. */
export function topUnits(units: TeacherUnit[]): TeacherUnit[] {
  return units.filter((u) => u.parent_id === null);
}

/** Direct children of a given unit. */
export function subfoldersOf(units: TeacherUnit[], parentId: string): TeacherUnit[] {
  return units.filter((u) => u.parent_id === parentId);
}

/**
 * Build a "Unit 5: Quadratics / Practice" label for any unit_id, or
 * "Uncategorized" when null. "Unknown" if the id doesn't resolve.
 */
export function unitLabel(units: TeacherUnit[], unitId: string | null): string {
  if (!unitId) return "Uncategorized";
  const u = units.find((x) => x.id === unitId);
  if (!u) return "Unknown";
  if (!u.parent_id) return u.name;
  const parent = units.find((x) => x.id === u.parent_id);
  return parent ? `${parent.name} / ${u.name}` : u.name;
}

