"use client";

import { Suspense, lazy, useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import DOMPurify from "dompurify";

const ChemDiagram = lazy(() => import("./chem-diagram").then((m) => ({ default: m.ChemDiagram })));
const MathGraph = lazy(() => import("./math-graph").then((m) => ({ default: m.MathGraph })));

/**
 * MathText — renders a string that may contain:
 *  - Inline LaTeX:  $...$
 *  - Display LaTeX: $$...$$
 *  - SVG diagrams:  <svg>...</svg>
 *  - Bold markdown: **...**
 *  - Plain text
 *
 * Falls back to raw text if KaTeX parsing fails.
 */

type DiagramData =
  | { diagram_type: "smiles"; smiles: string; label?: string }
  | { diagram_type: "graph"; functions?: { fn: string; color?: string }[]; points?: { x: number; y: number; label?: string }[]; xRange?: [number, number]; yRange?: [number, number] };

type Segment =
  | { type: "text"; content: string }
  | { type: "math-inline"; content: string }
  | { type: "math-display"; content: string }
  | { type: "svg"; content: string }
  | { type: "bold"; content: string }
  | { type: "diagram"; data: DiagramData };

/**
 * Restore LaTeX commands whose leading backslash was consumed by a JSON
 * string-escape collision. Commands like \rightarrow, \times, \frac, \vec,
 * \bullet arrive from the API with a literal control character in place
 * of the backslash (\r → U+000D, \t → U+0009, \f → U+000C, \v → U+000B,
 * \b → U+0008) because the server serialized them as raw Python string
 * literals instead of double-escaping before JSON encoding.
 *
 * This function is only ever called on content that's already been
 * bracketed by `$...$` or `$$...$$` delimiters — i.e. math mode — so
 * a control character followed by an alphabetic run is guaranteed to
 * be a broken LaTeX command and not legitimate whitespace. Applying it
 * only inside math segments avoids corrupting tab-indented prose,
 * code snippets, or carriage-return line endings in plain text.
 *
 * This is a client-side safety net. The real fix lives on the backend
 * (use raw strings or explicit double-escape before json.dumps), but
 * existing responses in the wild need to render correctly too.
 */
function restoreBrokenLatexCommands(mathSegment: string): string {
  return (
    mathSegment
      // \r ate a backslash: \rightarrow, \right, \rho, \rangle, \rceil, \rfloor, \rvert, \rbrace, \rbrack, \rm, \rule, …
      .replace(/\r([a-zA-Z]+)/g, "\\r$1")
      // \t ate a backslash: \times, \theta, \text, \tau, \to, \top, \triangle, \tilde, \tan, \tanh, …
      .replace(/\t([a-zA-Z]+)/g, "\\t$1")
      // \f ate a backslash: \frac, \forall, \fbox, \flat, \frown, …
      .replace(/\f([a-zA-Z]+)/g, "\\f$1")
      // \v ate a backslash: \vec, \varepsilon, \varphi, \vartheta, \vdots, \vee, \vspace, \vert, \vphantom, …
      .replace(/\v([a-zA-Z]+)/g, "\\v$1")
      // \x08 (backspace) ate a backslash: \backslash, \beta, \because, \binom, \bigcap, \bullet, \bar, \bot, …
      .replace(/\x08([a-zA-Z]+)/g, "\\b$1")
  );
}

/**
 * Detect strings that are bare LaTeX environments (e.g. `\begin{bmatrix}…\end{bmatrix}`
 * or `\begin{pmatrix}…\end{pmatrix}`) emitted without the usual `$…$` wrapping.
 * The AI grader returns `student_answer` in exactly this shape, so we render
 * it as display math instead of printing the source. Conservative on purpose:
 * only fires when the whole trimmed input opens with `\begin{` and closes with
 * `\end{...}`, avoiding any collision with prose that happens to contain a
 * backslash.
 */
function isBareLatexEnvironment(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("\\begin{")) return false;
  if (trimmed.includes("$")) return false;
  return /\\end\{[a-zA-Z*]+\}\s*$/.test(trimmed);
}

function parse(input: string): Segment[] {
  // Clean up before parsing
  let text = input.replace(/<br\s*\/?>/gi, "\n");
  // Strip arrow characters that Claude sometimes inserts inside SVG
  text = text.replace(/→\s*/g, "").replace(/←\s*/g, "");

  // Fast path: the whole string is a bare LaTeX environment. Treat as
  // display math so matrices / cases / aligned blocks render instead of
  // printing their source.
  if (isBareLatexEnvironment(text)) {
    return [{
      type: "math-display",
      content: restoreBrokenLatexCommands(text.trim()),
    }];
  }

  const segments: Segment[] = [];
  // Match @@{...}@@, $$...$$, $...$, <svg>...</svg>, and **...**
  const pattern = /(@@\{[\s\S]*?\}@@|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|<svg[\s\S]*?<\/svg>|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const idx = match.index!;
    if (idx > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, idx) });
    }

    const m = match[0];
    if (m.startsWith("@@{") && m.endsWith("}@@")) {
      try {
        const data = JSON.parse(m.slice(2, -2)) as DiagramData;
        segments.push({ type: "diagram", data });
      } catch {
        segments.push({ type: "text", content: m });
      }
    } else if (m.startsWith("$$") && m.endsWith("$$")) {
      segments.push({
        type: "math-display",
        content: restoreBrokenLatexCommands(m.slice(2, -2).trim()),
      });
    } else if (m.startsWith("$") && m.endsWith("$")) {
      segments.push({
        type: "math-inline",
        content: restoreBrokenLatexCommands(m.slice(1, -1).trim()),
      });
    } else if (m.startsWith("<svg")) {
      segments.push({ type: "svg", content: m });
    } else if (m.startsWith("**") && m.endsWith("**")) {
      segments.push({ type: "bold", content: m.slice(2, -2) });
    }

    lastIndex = idx + m.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return latex;
  }
}

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["svg", "path", "circle", "rect", "line", "polyline", "polygon", "text", "g", "defs", "marker", "tspan"],
    ADD_ATTR: ["viewBox", "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "fill", "stroke", "stroke-width", "font-size", "text-anchor", "transform", "points", "marker-end", "marker-start"],
  });
}

interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * IMPORTANT: must be wrapped in a block-level container (div, section,
 * etc.) — NEVER inside a <p>. Display math (matrices, fractions) emits
 * a top-level <div> here, and the HTML spec forbids <div> inside <p>.
 * Browsers auto-close the <p> on hydration → React mismatch error.
 */
export function MathText({ text, className }: MathTextProps) {
  const segments = useMemo(() => parse(text), [text]);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "text":
            return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{seg.content}</span>;
          case "bold":
            // Recursively parse so math/svg/etc. inside bold (e.g.
            // **Entry $h_{11}$**) renders correctly instead of as raw text.
            return (
              <strong key={i}>
                <MathText text={seg.content} />
              </strong>
            );
          case "math-inline":
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: renderKatex(seg.content, false) }}
              />
            );
          case "math-display":
            return (
              <div
                key={i}
                className="my-2 overflow-x-auto"
                dangerouslySetInnerHTML={{ __html: renderKatex(seg.content, true) }}
              />
            );
          case "svg":
            return (
              <div
                key={i}
                className="my-3 flex justify-center rounded-lg bg-white p-4"
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(seg.content) }}
              />
            );
          case "diagram":
            return (
              <Suspense key={i} fallback={<div className="my-3 h-32 animate-pulse rounded-lg bg-border-light" />}>
                {seg.data.diagram_type === "smiles" ? (
                  <ChemDiagram smiles={seg.data.smiles} label={seg.data.label} />
                ) : seg.data.diagram_type === "graph" ? (
                  <MathGraph
                    functions={seg.data.functions}
                    points={seg.data.points}
                    xRange={seg.data.xRange}
                    yRange={seg.data.yRange}
                  />
                ) : null}
              </Suspense>
            );
          default:
            return null;
        }
      })}
    </span>
  );
}
