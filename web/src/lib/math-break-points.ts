import katex from "katex";

/**
 * Give a run of INLINE LaTeX the line-break opportunities a reader expects
 * between the parts of a multi-part answer.
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
 * A break point goes after a `,` or `;`, and after `\quad` / `\qquad`,
 * only when it separates answer PARTS — i.e. at the top level:
 *   - outside every `{…}` group (so never inside a `\text{…}` argument,
 *     where the math-mode `\allowbreak` would be an error) and every
 *     `[…]` optional argument;
 *   - outside every grouping delimiter — `(…)`, `[…]`, `\{…\}`,
 *     `\langle…\rangle`, `\left…\right`, `\bigl…\bigr` and friends — so a
 *     coordinate pair `(3, 4)`, a set `\{1, 2\}` or an interval `[0, 1)`
 *     stays whole. Openers and closers share one depth that never goes
 *     below zero, so a half-open interval balances and an answer label's
 *     lone `)` ("a) …") doesn't lock the rest of the answer;
 *   - outside `\begin…\end` environments and `\verb` literals;
 *   - not before a digit (a thousands separator: `1,000`) or before a
 *     `^`, `_` or `'`, which would attach to the inserted break.
 * KaTeX keeps the spacing that follows a break point on the line before
 * it, so the next line never starts with a stray gap.
 */
export function allowMathBreaks(latex: string): string {
  let out = "";
  let braces = 0;
  let delims = 0; // (…)  […]  \{…\}  \langle…\rangle  \left…\right  \bigl…\bigr
  let envs = 0; // \begin … \end
  let i = 0;
  const n = latex.length;
  const atTop = () => braces === 0 && delims === 0 && envs === 0;
  const open = () => delims++;
  const close = () => {
    delims = Math.max(0, delims - 1);
  };
  // A break is useful only if something follows, and harmful if what
  // follows is a script or prime (it would attach to the break instead).
  const canBreakBefore = (j: number) => {
    while (j < n && /\s/.test(latex[j])) j++;
    return j < n && !/[\^_']/.test(latex[j]);
  };

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
      if (name === "verb") {
        // \verb<d>…<d> (or \verb*): copy verbatim through the closing
        // delimiter.
        if (latex[j] === "*") j++;
        const d = latex[j];
        const end = d === undefined ? -1 : latex.indexOf(d, j + 1);
        j = end === -1 ? n : end + 1;
        out += latex.slice(i, j);
        i = j;
        continue;
      }
      out += latex.slice(i, j);
      i = j;
      if (name === "left" || name === "{" || name === "langle" || name === "lbrace" ||
          name === "lbrack" || name === "lvert" || name === "lVert" || /^[bB]igg?l$/.test(name)) {
        open();
      } else if (name === "right" || name === "}" || name === "rangle" || name === "rbrace" ||
          name === "rbrack" || name === "rvert" || name === "rVert" || /^[bB]igg?r$/.test(name)) {
        close();
      } else if (name === "begin") {
        envs++;
      } else if (name === "end") {
        envs = Math.max(0, envs - 1);
      } else if ((name === "quad" || name === "qquad") && atTop() && canBreakBefore(i)) {
        out += "\\allowbreak ";
      }
      continue;
    }

    out += ch;
    i++;
    if (ch === "{") braces++;
    else if (ch === "}") braces = Math.max(0, braces - 1);
    else if (ch === "(" || ch === "[") open();
    else if (ch === ")" || ch === "]") close();
    else if ((ch === "," || ch === ";") && atTop() && !/[0-9]/.test(latex[i] ?? "") && canBreakBefore(i)) {
      out += "\\allowbreak ";
    }
  }
  return out;
}

// KaTeX's own attribute/text escaping, so the restored annotation is
// byte-identical to what KaTeX would have emitted for the original.
const ESCAPES: Record<string, string> = {
  "&": "&amp;", ">": "&gt;", "<": "&lt;", '"': "&quot;", "'": "&#x27;",
};
const escapeHtml = (s: string) => s.replace(/[&><"']/g, (c) => ESCAPES[c]);

/**
 * Render inline math with `allowMathBreaks` break points — safely.
 *
 * The rewrite must never change what the teacher sees beyond line
 * breaks. KaTeX's lenient mode (`throwOnError: false`) shows an
 * unparseable input as its SOURCE in red, and handwriting reads are
 * sometimes malformed (`a, b^`) — so rendering the rewrite leniently
 * would print our inserted `\allowbreak` into that red source. Instead
 * the rewrite is tried strictly, and anything it can't render falls
 * back to the untouched original on the normal lenient path.
 *
 * KaTeX also copies its input into the MathML `<annotation>` (what
 * screen readers and copy-paste use); that is restored to the original
 * source so the inserted commands never leak there either.
 */
export function renderBreakableInlineMath(
  latex: string,
  renderLenient: (latex: string) => string,
): string {
  const rewritten = allowMathBreaks(latex);
  if (rewritten === latex) return renderLenient(latex);
  let html: string;
  try {
    html = katex.renderToString(rewritten, {
      displayMode: false,
      throwOnError: true,
      strict: false,
    });
  } catch {
    return renderLenient(latex);
  }
  const annotation = `<annotation encoding="application/x-tex">${escapeHtml(rewritten)}</annotation>`;
  return html.replace(
    annotation,
    `<annotation encoding="application/x-tex">${escapeHtml(latex)}</annotation>`,
  );
}
