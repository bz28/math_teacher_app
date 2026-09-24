/**
 * Give a run of INLINE LaTeX the line-break opportunities a reader expects.
 *
 * KaTeX lays out inline math as a row of `.base` boxes (inline-block,
 * `nowrap`, each with a strut that reserves its full height) and only
 * starts a new box after a relation or binary operator. A multi-part
 * answer such as `a)\ \text{acute},\ b)\ \text{right},\ …` has neither,
 * so it renders as ONE unbreakable box that runs out of any narrow
 * column. KaTeX's own `\allowbreak` ends a box exactly like an operator
 * does — same struts, same spacing — so inserting it is the native way
 * to add break points without restyling KaTeX's DOM.
 *
 * Break points added, all at the TOP level only (outside every `{…}`
 * group, `\left…\right` pair and `\begin…\end` environment):
 *   - after a `,` or `;` that separates items — not a thousands
 *     separator like `1,000` (a digit right after the comma);
 *   - after `\quad` / `\qquad`, the usual gap between answer parts.
 * KaTeX keeps the spacing that follows a break point on the line before
 * it, so the next line never starts with a stray gap.
 *
 * Top level only, because that is the only place KaTeX splits boxes —
 * and `\allowbreak` is a math-mode symbol, so it must never land inside
 * a `\text{…}` argument, which is always a braced group.
 */
export function allowMathBreaks(latex: string): string {
  let out = "";
  let braces = 0;
  let fences = 0; // \left … \right
  let envs = 0; // \begin … \end
  let i = 0;
  const n = latex.length;
  const atTop = () => braces === 0 && fences === 0 && envs === 0;

  while (i < n) {
    const ch = latex[i];

    if (ch === "\\") {
      // A command: backslash + letters, or backslash + one other char
      // (`\,`, `\{`, `\\`, `\ `). Consume it whole so `\,` is never read
      // as a comma and `\{` never as a group.
      let j = i + 1;
      if (j < n && /[a-zA-Z]/.test(latex[j])) {
        while (j < n && /[a-zA-Z]/.test(latex[j])) j++;
      } else {
        j = Math.min(j + 1, n);
      }
      const name = latex.slice(i + 1, j);
      out += latex.slice(i, j);
      i = j;
      if (name === "left") fences++;
      else if (name === "right") fences = Math.max(0, fences - 1);
      else if (name === "begin") envs++;
      else if (name === "end") envs = Math.max(0, envs - 1);
      else if ((name === "quad" || name === "qquad") && atTop() && i < n) {
        out += "\\allowbreak ";
      }
      continue;
    }

    out += ch;
    i++;
    if (ch === "{") braces++;
    else if (ch === "}") braces = Math.max(0, braces - 1);
    else if ((ch === "," || ch === ";") && atTop() && i < n && !/[0-9]/.test(latex[i])) {
      out += "\\allowbreak ";
    }
  }
  return out;
}
