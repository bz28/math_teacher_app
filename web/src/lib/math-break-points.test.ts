import { test } from "node:test";
import assert from "node:assert/strict";

import { allowMathBreaks } from "./math-break-points.ts";

const B = "\\allowbreak ";

test("breaks after item-separating commas in a multi-part answer", () => {
  assert.equal(
    allowMathBreaks(String.raw`a)\ \text{acute},\ b)\ \text{right}`),
    String.raw`a)\ \text{acute},` + B + String.raw`\ b)\ \text{right}`,
  );
});

test("breaks after \\quad / \\qquad, and after semicolons", () => {
  assert.equal(
    allowMathBreaks(String.raw`x = 1\quad y = 2\qquad z = 3`),
    String.raw`x = 1\quad` + B + String.raw` y = 2\qquad` + B + " z = 3",
  );
  assert.equal(allowMathBreaks("x = 1; y = 2"), "x = 1;" + B + " y = 2");
});

test("never inside a braced group — \\text{} arguments stay math-mode clean", () => {
  const src = String.raw`\text{acute, right, obtuse}`;
  assert.equal(allowMathBreaks(src), src);
  assert.equal(allowMathBreaks("x_{1,2}"), "x_{1,2}");
});

test("never inside \\left…\\right or an environment", () => {
  const fenced = String.raw`\left(1, 2\right)`;
  assert.equal(allowMathBreaks(fenced), fenced);
  const env = String.raw`\begin{cases} a, & x > 0 \\ b, & x \le 0 \end{cases}`;
  assert.equal(allowMathBreaks(env), env);
  // …but resumes once the fence closes.
  assert.equal(
    allowMathBreaks(String.raw`\left(1, 2\right), (3, 4)`),
    String.raw`\left(1, 2\right),` + B + " (3," + B + " 4)",
  );
});

test("leaves thousands separators and spacing commands alone", () => {
  assert.equal(allowMathBreaks("1,000,000"), "1,000,000");
  assert.equal(allowMathBreaks(String.raw`1\,000`), String.raw`1\,000`);
  assert.equal(allowMathBreaks(String.raw`\{a, b\}`), String.raw`\{a,` + B + String.raw` b\}`);
});

test("no break after a trailing separator; short answers unchanged", () => {
  assert.equal(allowMathBreaks("x = 4,"), "x = 4,");
  assert.equal(allowMathBreaks(String.raw`\frac{3}{4}`), String.raw`\frac{3}{4}`);
  assert.equal(allowMathBreaks(String.raw`2\sqrt{3}x`), String.raw`2\sqrt{3}x`);
});
