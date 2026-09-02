"use client";

import { Suspense, lazy, useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { sanitizeSvg } from "@/lib/sanitize-svg";

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
// \n (newline) is ambiguous with legitimate prose, so — unlike the other
// control chars — we only restore it when "n" + the run is a real \n-command.
// Real multiline math separates rows with `\\` + whitespace (newline -> space
// -> token), which doesn't match `\n[letter]`, so it's left alone. The residual
// edge is a BARE newline immediately before a command-letter run; to shrink it
// we drop the 1-char-suffix commands (\ne, \nu, \ni) that collide most easily
// with a row starting "e"/"u"/"i" — \neq, \nabla, etc. still restore.
const N_COMMANDS = new Set([
  "neq", "nabla", "not", "nmid", "nleq", "ngeq", "nless",
  "ngtr", "nparallel", "ncong", "nsim", "nsubseteq", "nsupseteq",
  "nrightarrow", "nleftarrow", "natural",
]);

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
      // \n ate a backslash: \neq, \nabla, … — whitelisted (see N_COMMANDS).
      .replace(/\n([a-zA-Z]+)/g, (m, run) => (N_COMMANDS.has("n" + run) ? "\\n" + run : m))
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

// A LaTeX-escaped dollar (`\$`) means a LITERAL dollar sign, not a math
// delimiter — word problems write currency as "\$0.50". The segment
// matcher keys off bare `$`, so before matching we swap every `\$` for a
// private-use sentinel it can't see, then restore it per segment: as a
// plain `$` in prose, as `\$` inside math (where KaTeX renders the
// literal). Without this, "paid \$0.50 … at \$2.00" parses the span
// between the two dollars as math — the classic currency-as-math bug.
// (A sentinel, not a regex lookbehind: lookbehind throws on Safari
// <16.4 and would break ALL math rendering there.)
const DOLLAR_SENTINEL = "\uE000";
const restoreDollarText = (s: string) => s.replaceAll(DOLLAR_SENTINEL, "$");
const restoreDollarMath = (s: string) => s.replaceAll(DOLLAR_SENTINEL, "\\$");

function parse(input: string): Segment[] {
  // `text` is typed `string`, but this component is the render target for
  // free-form JSON the API stores without validating — `Assignment.rubric`
  // fields, extraction blobs, AI-authored reasoning. A value that isn't a
  // string used to throw here, and because MathText renders inside the
  // teacher's grading and homework pages, one bad row took the entire page
  // down behind an error boundary with no way back from the UI. Degrade to
  // showing what's there instead: a renderer should never be the thing that
  // makes a page unreachable.
  // Cast through `unknown`: the prop is declared `string`, so TS narrows
  // the guard below to `never` without it. The guard is about runtime
  // values the type system never saw, not about the declared type.
  const raw: unknown = input;
  if (typeof raw !== "string") {
    if (raw == null) return [];
    // Arrays are the shape actually seen in the wild (a rubric field
    // stored as a list of strings); join them the way a person would,
    // matching how migration cl1000081 normalizes the same shape.
    if (Array.isArray(raw)) {
      const joined = raw
        .filter((v): v is string | number =>
          typeof v === "string" || typeof v === "number",
        )
        .map((v) => String(v).trim())
        .filter(Boolean)
        .join("; ");
      return joined ? [{ type: "text", content: joined }] : [];
    }
    // A number or boolean has an honest rendering; an object does not —
    // "[object Object]" is worse than showing nothing, and it is the same
    // call the migration makes for a nested value.
    if (typeof raw === "number" || typeof raw === "boolean") {
      return [{ type: "text", content: String(raw) }];
    }
    return [];
  }
  // Clean up before parsing
  let text = input.replace(/<br\s*\/?>/gi, "\n");
  // Protect escaped (literal) dollars from the math-delimiter matcher.
  text = text.replace(/\\\$/g, DOLLAR_SENTINEL);

  // Fast path: the whole string is a bare LaTeX environment. Treat as
  // display math so matrices / cases / aligned blocks render instead of
  // printing their source.
  if (isBareLatexEnvironment(text)) {
    return [{
      type: "math-display",
      content: restoreDollarMath(restoreBrokenLatexCommands(text.trim())),
    }];
  }

  const segments: Segment[] = [];
  // Match @@{...}@@, $$...$$, $...$, <svg>...</svg>, and **...**
  const pattern = /(@@\{[\s\S]*?\}@@|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|<svg[\s\S]*?<\/svg>|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const idx = match.index!;
    if (idx > lastIndex) {
      segments.push({ type: "text", content: restoreDollarText(text.slice(lastIndex, idx)) });
    }

    const m = match[0];
    if (m.startsWith("@@{") && m.endsWith("}@@")) {
      try {
        const data = JSON.parse(m.slice(2, -2)) as DiagramData;
        segments.push({ type: "diagram", data });
      } catch {
        segments.push({ type: "text", content: restoreDollarText(m) });
      }
    } else if (m.startsWith("$$") && m.endsWith("$$")) {
      segments.push({
        type: "math-display",
        content: restoreDollarMath(restoreBrokenLatexCommands(m.slice(2, -2).trim())),
      });
    } else if (m.startsWith("$") && m.endsWith("$")) {
      segments.push({
        type: "math-inline",
        content: restoreDollarMath(restoreBrokenLatexCommands(m.slice(1, -1).trim())),
      });
    } else if (m.startsWith("<svg")) {
      // Strip stray Unicode arrows (→ ←) Claude sometimes injects into SVG
      // markup, where they break rendering. Scoped to the SVG segment so
      // legitimate prose/math arrows ("as x → 0", "f: A → B") survive.
      segments.push({ type: "svg", content: m.replace(/→\s*/g, "").replace(/←\s*/g, "") });
    } else if (m.startsWith("**") && m.endsWith("**")) {
      // Bold content is RE-PARSED by a nested <MathText> (render switch),
      // so it must stay in source form: restore the sentinel to `\$`, not a
      // bare `$`, or the inner parse would read "**\$5 or \$10**" as math
      // again — reintroducing the very currency-as-math bug this fixes.
      segments.push({ type: "bold", content: restoreDollarMath(m.slice(2, -2)) });
    }

    lastIndex = idx + m.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: restoreDollarText(text.slice(lastIndex)) });
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


interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * The same content as `MathText` renders, flattened to plain text for an
 * `aria-label`, a `title`, or anywhere else a string is required.
 *
 * Built on the SAME `parse()` the renderer uses, deliberately. The
 * obvious alternative -- strip `$` delimiters with a regex -- was tried
 * three times and diverged three times, because the matcher makes one
 * left-to-right pass over five alternatives and a sequence of global
 * replaces cannot reproduce that: it strips pairs the real pass never
 * saw (`$$$x$$$`), and has no counterpart for `<br>`, `**bold**`,
 * `<svg>` or `@@{...}@@` at all. Anything derived from the segments
 * agrees with the render by construction.
 *
 * Math keeps its LaTeX source, minus the delimiters -- this is not a
 * LaTeX-to-speech converter, it just isn't source. Diagrams and SVG
 * contribute nothing: they have no text a screen reader can use, and
 * emitting their markup would be worse than silence.
 */
export function mathPlainText(input: string): string {
  return parse(input)
    .map((seg) => {
      switch (seg.type) {
        case "text":
        case "math-inline":
        case "math-display":
          return seg.content;
        case "bold":
          // `parse` keeps bold content in SOURCE form on purpose — the
          // renderer hands it to a nested MathText — so it still holds
          // delimiters and escapes. Recurse, or the label reports the
          // source for bold while reporting the value everywhere else.
          return mathPlainText(seg.content);
        default:
          return "";
      }
    })
    // No separator: the renderer emits segments adjacently, and whatever
    // space belongs between them is already in the text around the
    // delimiters. Joining on " " put one before the comma in
    // `$x = 3$, $y = -2$`.
    .join("")
    // Math segments come back carrying `\$` and text segments a bare `$`
    // (the two restore helpers differ, correctly, for their own render
    // paths). Both are one dollar sign to a reader, so settle on the one
    // that reads out as money rather than as an escape.
    .replace(/\\\$/g, "$")
    .replace(/\s+/g, " ")
    .trim();
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
