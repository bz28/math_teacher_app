import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";

import { allowMathBreaks, renderBreakableInlineMath } from "./math-break-points.ts";

const B = "\\allowbreak ";

test("breaks after item-separating commas in a multi-part answer", () => {
  assert.equal(
    allowMathBreaks(String.raw`a)\ \text{acute},\ b)\ \text{right}`),
    String.raw`a)\ \text{acute},` + B + String.raw`\ b)\ \text{right}`,
  );
  assert.equal(
    allowMathBreaks(String.raw`m\angle JKM = 138^\circ,\quad m\angle JKN = 207^\circ`),
    String.raw`m\angle JKM = 138^\circ,` + B + String.raw`\quad` + B + String.raw` m\angle JKN = 207^\circ`,
  );
});

test("breaks after \\quad / \\qquad, and after semicolons", () => {
  assert.equal(
    allowMathBreaks(String.raw`x = 1\quad y = 2\qquad z = 3`),
    String.raw`x = 1\quad` + B + String.raw` y = 2\qquad` + B + " z = 3",
  );
  assert.equal(allowMathBreaks("x = 1; y = 2"), "x = 1;" + B + " y = 2");
});

test("never inside a braced group or an optional [...] argument", () => {
  const src = String.raw`\text{acute, right, obtuse}`;
  assert.equal(allowMathBreaks(src), src);
  assert.equal(allowMathBreaks("x_{1,2}"), "x_{1,2}");
  assert.equal(allowMathBreaks(String.raw`\sqrt[3, 4]{x}`), String.raw`\sqrt[3, 4]{x}`);
});

test("tuples, sets and intervals stay whole; breaks resume between them", () => {
  for (const src of [
    "(3, 4)",
    String.raw`\{1, 2\}`,
    "[0, 1)",
    "(0, 1]",
    String.raw`\langle 1, 2\rangle`,
    String.raw`\left(1, 2\right)`,
    String.raw`\bigl(1, 2\bigr)`,
    String.raw`\begin{cases} a, & x > 0 \\ b, & x \le 0 \end{cases}`,
  ]) {
    assert.equal(allowMathBreaks(src), src, src);
  }
  assert.equal(
    allowMathBreaks(String.raw`A = (3, 4),\ B = \left(1, 2\right)`),
    String.raw`A = (3, 4),` + B + String.raw`\ B = \left(1, 2\right)`,
  );
  // An answer label's lone ")" doesn't lock the rest of the answer.
  assert.equal(allowMathBreaks("a) 3, b) 4"), "a) 3," + B + " b) 4");
});

test("no break before a digit, script or prime, or at the end", () => {
  assert.equal(allowMathBreaks("1,000,000"), "1,000,000");
  assert.equal(allowMathBreaks(String.raw`1\,000`), String.raw`1\,000`);
  assert.equal(allowMathBreaks("a,^2"), "a,^2");
  assert.equal(allowMathBreaks("a, _1"), "a, _1");
  assert.equal(allowMathBreaks("f(x),'"), "f(x),'");
  assert.equal(allowMathBreaks(String.raw`x\quad^2`), String.raw`x\quad^2`);
  assert.equal(allowMathBreaks("x = 4,"), "x = 4,");
  assert.equal(allowMathBreaks(String.raw`x\quad`), String.raw`x\quad`);
});

test("\\verb literals are copied verbatim", () => {
  assert.equal(allowMathBreaks(String.raw`\verb|a, b|, c`), String.raw`\verb|a, b|,` + B + " c");
});

test("short answers are unchanged", () => {
  for (const src of [String.raw`\frac{3}{4}`, "x = 4", String.raw`2\sqrt{3}x`, String.raw`90^\circ`]) {
    assert.equal(allowMathBreaks(src), src);
  }
});

// Every rewrite must parse wherever the original does — the inserted
// break points may never turn a good answer into a KaTeX error.
const CORPUS = [
  String.raw`a)\ \text{acute},\ b)\ \text{right},\ c)\ \text{obtuse},\ d)\ \text{straight}`,
  String.raw`m\angle JKM = 138^\circ,\quad m\angle JKN = 207^\circ`,
  String.raw`x = \left(\dfrac{1}{2}\right)^{2} + \left[\dfrac{a}{b}\right],\ y = \displaystyle\sum_{i=1}^{n} i`,
  String.raw`a)\ 3\frac{1}{2},\ b)\ 12\frac{3}{4},\ c)\ 2\sqrt{3}x,\ d)\ 1\,000\,000`,
  "a, b", "x = 1, y = 2", "(3, 4)", "a;b", String.raw`x=1\quad y=2`, "f(x),'", "a,^2", "a,_1",
  String.raw`\sqrt[3, 4]{x}`, String.raw`\xrightarrow[a, b]{c}`, String.raw`\frac12, \frac34`,
  String.raw`\bigl(1, 2\bigr)`, String.raw`\mathbf a, b`, String.raw`x\quad`, String.raw`\quad^2`,
  String.raw`\overbrace{a,b}^{n}, c`, String.raw`a,\\ b`, String.raw`\operatorname{f}, g`,
  String.raw`\mathrm{kg}, 5`, String.raw`x \in \{1, 2\}`, String.raw`a,\!b`, String.raw`\overset{a,b}{=}`,
  String.raw`{a \over b}, c`, String.raw`a,\nobreak b`, String.raw`1,\ 000`, String.raw`\hphantom{,}, x`,
  String.raw`a\,, b`, String.raw`\text{a}\quad\text{b}`, "a,~b", String.raw`a,\mathord{b}`,
  String.raw`\lim_{x\to0}, y`, String.raw`\color{red} a, b`, String.raw`\verb|a, b|, c`, "a ,b", "a, -1",
  "a, +1", String.raw`A \cup B, C`, "[0, 1), (2, 3]", String.raw`\langle 1, 2 \rangle, x`,
  String.raw`\begin{pmatrix} 1, 2 \\ 3, 4 \end{pmatrix}, x`,
];

test("rewritten output parses in KaTeX wherever the original does", () => {
  const parses = (s: string) => {
    try {
      katex.renderToString(s, { throwOnError: true, strict: false });
      return true;
    } catch {
      return false;
    }
  };
  for (const src of CORPUS) {
    if (!parses(src)) continue;
    assert.ok(parses(allowMathBreaks(src)), `rewrite broke: ${src} -> ${allowMathBreaks(src)}`);
  }
});

const lenient = (s: string) => katex.renderToString(s, { throwOnError: false, strict: false });
const annotation = (html: string) =>
  html.match(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/)?.[1];

test("malformed input falls back to the untouched original, never the rewrite", () => {
  // `a, b^` can't parse; the lenient render shows its source in red —
  // which must be the student's source, not ours with \allowbreak in it.
  const html = renderBreakableInlineMath("a, b^", lenient);
  assert.equal(html, lenient("a, b^"));
  assert.ok(!html.includes("\\allowbreak"));
  const unknown = renderBreakableInlineMath(String.raw`x = 1, \foo{2}`, lenient);
  assert.equal(unknown, lenient(String.raw`x = 1, \foo{2}`));
  assert.ok(!unknown.includes("\\allowbreak"));
});

test("the tex annotation carries the ORIGINAL source", () => {
  // Includes `<` and `"` — the restore uses KaTeX's own escaping, so
  // HTML-special characters must round-trip exactly.
  const src = String.raw`a)\ \text{acute},\ b)\ x < 1,\ c)\ \text{"right"}`;
  const html = renderBreakableInlineMath(src, lenient);
  assert.ok(!html.includes("\\allowbreak"), "inserted command leaked into the output");
  assert.equal(annotation(html), annotation(lenient(src)));
  // …while the layout really did get the extra break point.
  assert.ok(
    (html.match(/class="base"/g) ?? []).length > (lenient(src).match(/class="base"/g) ?? []).length,
  );
});

test("unchanged input takes the plain lenient path", () => {
  assert.equal(renderBreakableInlineMath("x = 4", lenient), lenient("x = 4"));
});
