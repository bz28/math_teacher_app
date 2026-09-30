import { Fragment, useMemo } from "react";
import katex from "katex";
// Every MathText brings its own stylesheet: without it KaTeX output is
// unstyled markup, and a page that renders math must not depend on some
// other page having been visited first to load it.
import "katex/dist/katex.min.css";

// Renders a string of mixed prose + LaTeX. Math is delimited with $...$
// (inline) or $$...$$ (display), the same convention the question bank stores.
// Everything else is plain text; newlines are preserved and light markdown
// bold (**x**) is unwrapped so it doesn't leak literal asterisks.

type Seg = { type: "text" | "inline" | "display"; value: string };

function tokenize(text: string): Seg[] {
  const segs: Seg[] = [];
  // Delimiters are UNescaped `$` / `$$`. Math content may legitimately contain
  // an escaped `\$` (currency, e.g. "rate $\$0.08$") or LaTeX commands like
  // `\frac` — so consume `\\.` (a backslash + its char) as one unit and never
  // split on an escaped dollar. Without this the escaped `$` is read as a
  // closing delimiter and the segment renders as garbage.
  const re = /(?<!\\)\$\$((?:\\.|[^$])+?)\$\$|(?<!\\)\$((?:\\.|[^$\n])+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] !== undefined) segs.push({ type: "display", value: m[1] });
    else segs.push({ type: "inline", value: m[2]! });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ type: "text", value: text.slice(last) });
  return segs;
}

function renderMath(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: display,
      // default output (htmlAndMathml) keeps the MathML layer for screen readers
    });
  } catch {
    // `throwOnError: false` covers parse errors only; anything else (a
    // stack overflow on deeply nested braces, say) still throws. The
    // fallback is injected as HTML, and the source can be text a student
    // typed, so it must be escaped — returning it raw let a crafted
    // correction run script in an admin's browser.
    return escapeHtml(latex);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function PlainText({ value }: { value: string }) {
  // `\$` is the escaped dollar the tokenizer refused to split on — outside
  // maths it is just a dollar sign.
  const clean = value.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\\\$/g, "$");
  const lines = clean.split("\n");
  return (
    <>
      {lines.map((ln, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {ln}
        </Fragment>
      ))}
    </>
  );
}

export default function MathText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const segs = useMemo(() => tokenize(children || ""), [children]);
  return (
    <span className={className}>
      {segs.map((s, i) =>
        s.type === "text" ? (
          <PlainText key={i} value={s.value} />
        ) : (
          <span
            key={i}
            className={s.type === "display" ? "gs-math-display" : "gs-math-inline"}
            dangerouslySetInnerHTML={{ __html: renderMath(s.value, s.type === "display") }}
          />
        ),
      )}
    </span>
  );
}
