import type { BankItem, TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";

// Tree node = a root question + any practice variations under it.
// Variations are bank items whose parent_question_id points at the root.
export type TreeNode = { item: BankItem; children: BankItem[] };

export function buildTree(items: BankItem[]): TreeNode[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenByParent = new Map<string, BankItem[]>();
  for (const item of items) {
    const pid = item.parent_question_id;
    if (pid && byId.has(pid)) {
      const arr = childrenByParent.get(pid) ?? [];
      arr.push(item);
      childrenByParent.set(pid, arr);
    }
  }
  // Roots = items without a parent in this view (orphans get promoted).
  return items
    .filter((item) => !item.parent_question_id || !byId.has(item.parent_question_id))
    .map((item) => ({ item, children: childrenByParent.get(item.id) ?? [] }));
}

// Group items by unit for visual scanning. Top units come first in
// position order, with their subfolders nested via breadcrumb labels.
// "Uncategorized" goes last.
export function buildUnitGroups(
  items: BankItem[],
  units: TeacherUnit[],
): { id: string; label: string; items: BankItem[] }[] {
  const groups: { id: string; label: string; items: BankItem[] }[] = [];
  const itemsIn = (uid: string | null) => items.filter((i) => i.unit_id === uid);
  for (const top of topUnits(units)) {
    const own = itemsIn(top.id);
    if (own.length > 0) groups.push({ id: top.id, label: top.name, items: own });
    for (const sub of subfoldersOf(units, top.id)) {
      const subItems = itemsIn(sub.id);
      if (subItems.length > 0) {
        groups.push({ id: sub.id, label: `${top.name} / ${sub.name}`, items: subItems });
      }
    }
  }
  const uncat = itemsIn(null);
  if (uncat.length > 0) groups.push({ id: "uncategorized", label: "Uncategorized", items: uncat });
  return groups;
}
