// Where the graph checklist's "check these values" numbers sit in an
// item's text, for underlining them in place.

const FRACTIONS: Record<string, [string, string]> = {
  "½": ["1", "2"], "⅓": ["1", "3"], "⅔": ["2", "3"], "¼": ["1", "4"], "¾": ["3", "4"],
};

/** `text` cut around the numbers in `values`, read the way the server
 *  reads them (`drawing_check._numbers`): a minus right before the digits
 *  is the number's sign, "1,000" is one number, ".5" is 0.5, "½" is 1
 *  over 2, and exponents are skipped. */
export function splitValues(text: string, values: string[]): { text: string; values?: string[] }[] {
  if (values.length === 0) return [{ text }];
  const wanted = new Set(values);
  const parts: { text: string; values?: string[] }[] = [];
  let last = 0;
  const re = /(?<![\w.^])([-−]\s?)?(\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:\.\d+)?|\.\d+|[½⅓⅔¼¾])/g;
  for (const m of text.matchAll(re)) {
    if (text.slice(0, m.index).endsWith("^{")) continue;
    const sign = m[1] ? "-" : "";
    const nums = FRACTIONS[m[2]]
      ? [sign + FRACTIONS[m[2]][0], FRACTIONS[m[2]][1]]
      : [sign + normalize(m[2])];
    const hits = nums.map((n) => (n === "-0" ? "0" : n)).filter((n) => wanted.has(n));
    if (hits.length === 0) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], values: hits });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function normalize(n: string): string {
  let out = n.replace(/,/g, "");
  if (out.startsWith(".")) out = "0" + out;
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}
