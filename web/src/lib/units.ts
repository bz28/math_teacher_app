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
 * Roll a (possibly subfolder) unit_id up to its top-level unit. Returns
 * null when given null. Returns the input id unchanged if the unit
 * isn't found in the list (defensive — treat unknown as top).
 *
 * Used when grouping/filtering by top-level units while still
 * tolerating items whose unit_id points at a subfolder (e.g. a bank
 * question saved into a subfolder of math should still be visible
 * when filtering by math at the top level).
 */
export function topUnitIdOf(
  units: TeacherUnit[], unitId: string | null,
): string | null {
  if (!unitId) return null;
  const u = units.find((x) => x.id === unitId);
  if (!u) return unitId;
  return u.parent_id ?? u.id;
}

/**
 * Build a "Unit 5: Quadratics / Practice" label for any unit_id.
 * "Unknown" if the id doesn't resolve. The Uncategorized branch was
 * removed when bd1000047 made unit_id NOT NULL across the board.
 */
export function unitLabel(units: TeacherUnit[], unitId: string): string {
  const u = units.find((x) => x.id === unitId);
  if (!u) return "Unknown";
  if (!u.parent_id) return u.name;
  const parent = units.find((x) => x.id === u.parent_id);
  return parent ? `${parent.name} / ${u.name}` : u.name;
}

