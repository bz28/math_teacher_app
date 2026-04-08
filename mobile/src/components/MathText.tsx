import React from "react";
import { Text, TextStyle } from "react-native";

/**
 * Lightweight math text renderer for mobile.
 *
 * Strips $...$ and $$...$$ delimiters and substitutes the most common LaTeX
 * commands with unicode equivalents so students stop seeing literal dollar
 * signs around symbols. This is intentionally a pure-JS approach with zero
 * native deps so it works in Expo Go without ejecting.
 *
 * Coverage:
 * - $...$, $$...$$, \(...\), \[...\] delimiters
 * - **bold** markdown
 * - Greek letters (\alpha, \beta, \pi, etc.)
 * - Common operators (\times, \div, \pm, \leq, \geq, \neq, \approx, \infty)
 * - Superscripts (x^2, x^{12})
 * - Subscripts (x_i, x_{12})
 * - \sqrt{x} and \sqrt[n]{x}
 * - \frac{a}{b}  →  a/b   (visual hack, not pretty but readable)
 *
 * Anything more complex (matrices, integrals with bounds, etc.) falls through
 * as cleaned-up text. A real KaTeX-via-WebView renderer is the next step if
 * we need pretty rendering.
 */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ",
  Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ",
  Nu: "Ν", Xi: "Ξ", Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ",
  Tau: "Τ", Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
};

const OPERATORS: Record<string, string> = {
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "·",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡", sim: "∼",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  in: "∈", notin: "∉", subset: "⊂", supset: "⊃", cup: "∪", cap: "∩",
  sum: "∑", prod: "∏", int: "∫", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔", degree: "°",
};

const SUPER_DIGITS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
};

const SUB_DIGITS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "i": "ᵢ", "j": "ⱼ", "o": "ₒ", "x": "ₓ", "n": "ₙ",
};

function toSuper(s: string): string {
  return s.split("").map((c) => SUPER_DIGITS[c] ?? c).join("");
}

function toSub(s: string): string {
  return s.split("").map((c) => SUB_DIGITS[c] ?? c).join("");
}

/** Replace LaTeX inside a math segment with unicode-friendly text. */
function renderMathSegment(input: string): string {
  let s = input;

  // \frac{a}{b} → (a)/(b) — recursive in case of nested
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
    if (s === before) break;
  }

  // \sqrt[n]{x} → ⁿ√(x)
  s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, n, x) => `${toSuper(n)}√(${x})`);
  // \sqrt{x} → √(x)
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");

  // x^{...} → x followed by superscript-substituted braces
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, body) => toSuper(body));
  // x^c (single char/digit, no braces)
  s = s.replace(/\^(\w)/g, (_m, c) => toSuper(c));

  // x_{...}
  s = s.replace(/_\{([^{}]*)\}/g, (_m, body) => toSub(body));
  // x_c
  s = s.replace(/_(\w)/g, (_m, c) => toSub(c));

  // Greek letters
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => {
    if (GREEK[name]) return GREEK[name];
    if (OPERATORS[name]) return OPERATORS[name];
    return m; // leave unknown commands alone
  });

  // Strip stray braces from grouping
  s = s.replace(/[{}]/g, "");

  return s;
}

/** Split bold markdown into parts; bold parts are wrapped. */
function renderBoldRuns(text: string, baseStyle: TextStyle): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(
        <Text key={`b${i}`} style={[baseStyle, { fontWeight: "700" }]}>
          {part.slice(2, -2)}
        </Text>,
      );
    } else {
      out.push(part);
    }
  });
  return out;
}

interface MathTextProps {
  text: string;
  style?: TextStyle;
  numberOfLines?: number;
}

/**
 * Render text with embedded math.
 *
 * Splits on $...$, $$...$$, \(...\), and \[...\] delimiters. Math segments are
 * passed through `renderMathSegment` for unicode substitution. Plain segments
 * additionally support **bold** markdown.
 */
export function MathText({ text, style, numberOfLines }: MathTextProps) {
  if (!text) return null;

  // Split on $$...$$, $...$, \(...\), \[...\]
  // We use a single regex with alternation; capture groups identify delimiters.
  const splitter = /(\$\$[^$]+\$\$|\$[^$]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g;
  const parts = text.split(splitter);

  const baseStyle: TextStyle = style ?? {};

  return (
    <Text style={baseStyle} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        if (!part) return null;
        // Detect math delimiters and strip them
        let inner: string | null = null;
        if (part.startsWith("$$") && part.endsWith("$$")) inner = part.slice(2, -2);
        else if (part.startsWith("$") && part.endsWith("$")) inner = part.slice(1, -1);
        else if (part.startsWith("\\(") && part.endsWith("\\)")) inner = part.slice(2, -2);
        else if (part.startsWith("\\[") && part.endsWith("\\]")) inner = part.slice(2, -2);

        if (inner !== null) {
          return (
            <Text key={i} style={[baseStyle, { fontStyle: "italic" }]}>
              {renderMathSegment(inner)}
            </Text>
          );
        }

        // Non-math text — handle bold
        return <React.Fragment key={i}>{renderBoldRuns(part, baseStyle)}</React.Fragment>;
      })}
    </Text>
  );
}
