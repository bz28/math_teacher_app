/** The section names typed into New section: one, or several at once
 *  ("Period 1, Period 3", or one per line). Trimmed, blanks dropped,
 *  repeats (ignoring case) kept once, in the order typed. */
export function sectionNames(input: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
