/**
 * A school scope named in a page's URL — `?school=` (Costs links, the LLM
 * calls page's old deep links) or `?school_id=` (Audit log's). Pure, so
 * `npm test` pins it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Written by a copied link made on All schools, so the recipient's own
 *  saved scope can't quietly stand in for it. */
export const ALL_SCHOOLS = "all";

/** `{ school: id }` or `{ school: null }` (All schools) when the URL says
 *  which; null when it says nothing usable. UUIDs only, so a mangled link
 *  can't scope every page to nothing. */
export function urlSchoolParam(params: URLSearchParams): { school: string | null } | null {
  const v = params.get("school") ?? params.get("school_id");
  if (v === ALL_SCHOOLS) return { school: null };
  return v && UUID_RE.test(v) ? { school: v } : null;
}
