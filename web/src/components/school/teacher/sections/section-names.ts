/** The section names typed into New section: one, or several at once
 *  ("Period 1, Period 3"; a pasted column arrives through pastedLines).
 *  Trimmed, blanks dropped,
 *  repeats (ignoring case) kept once, in the order typed. */
export function sectionNames(input: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of input.split(",")) {
    const name = raw.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Pasted text with line breaks (a column copied from a spreadsheet or a
 *  roster) as comma-separated names, since the field is one line. */
export function pastedLines(text: string): string {
  return text
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
}
