// The Add-from-bank picker's list: the course's approved questions a
// homework can take, grouped by the homework (or practice set) they came
// from, filtered by unit and a search. Pure, so it runs under node --test.
import type { BankItem } from "@/lib/api";

export interface BankGroup {
  /** The homework's id, or "" for questions on no homework yet. */
  key: string;
  title: string;
  /** "Published" / "Draft" / "Practice · Published"…; "" for the loose group. */
  detail: string;
  items: BankItem[];
}

export const LOOSE_GROUP_TITLE = "Not on a homework yet";

type Pickable = Pick<
  BankItem,
  "id" | "title" | "question" | "status" | "unit_id" | "parent_question_id" | "used_in"
>;

/** Lower-case words of the search, each of which must appear. */
function matches(item: Pickable, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = `${item.title} ${item.question}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function groupBankItems<T extends Pickable>(
  items: T[],
  opts: {
    excludeIds?: Iterable<string>;
    query?: string;
    /** A unit and its subfolders; null or absent = every unit. */
    unitIds?: ReadonlySet<string> | null;
  },
): (Omit<BankGroup, "items"> & { items: T[] })[] {
  const exclude = new Set(opts.excludeIds ?? []);
  const words = (opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, Omit<BankGroup, "items"> & { items: T[] }>();
  for (const item of items) {
    // Only approved primaries can go on a homework (the server refuses
    // anything else: api/services/bank.py snapshot_bank_items).
    if (item.status !== "approved" || item.parent_question_id) continue;
    if (exclude.has(item.id)) continue;
    if (opts.unitIds && !opts.unitIds.has(item.unit_id)) continue;
    if (!matches(item, words)) continue;
    const home =
      item.used_in.find((u) => u.type === "homework") ?? item.used_in[0] ?? null;
    const key = home?.id ?? "";
    let g = groups.get(key);
    if (!g) {
      const status = home ? capitalize(home.status) : "";
      g = {
        key,
        title: home?.title ?? LOOSE_GROUP_TITLE,
        detail: home ? (home.type === "practice" ? `Practice · ${status}` : status) : "",
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1; // the loose group goes last
    return a.title.localeCompare(b.title);
  });
}
