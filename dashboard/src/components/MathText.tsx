import { Fragment, useMemo } from "react";
import katex from "katex";

// Renders a string of mixed prose + LaTeX. Math is delimited with $...$
// (inline) or $$...$$ (display), the same convention the question bank stores.
// Everything else is plain text; newlines are preserved and light markdown
// bold (**x**) is unwrapped so it doesn't leak literal asterisks.

type Seg = { type: "text" | "inline" | "display"; value: string };

function tokenize(text: string): Seg[] {
  const segs: Seg[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
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
      output: "html",
    });
  } catch {
    return latex;
  }
}

function PlainText({ value }: { value: string }) {
  const clean = value.replace(/\*\*(.+?)\*\*/g, "$1");
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
