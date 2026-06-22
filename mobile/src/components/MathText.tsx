import { useMemo, useState } from "react";
import { StyleSheet, Text, TextStyle, View } from "react-native";
import { WebView } from "react-native-webview";
import katex from "katex";
import { KATEX_CSS } from "../katexCss";
import { typography, useColors } from "../theme";

/**
 * Mobile MathText — renders text with embedded LaTeX the same way the
 * web version does, by pre-rendering LaTeX to HTML via katex.renderToString
 * (pure JS, no DOM needed) and injecting the result into a WebView with
 * KaTeX CSS loaded from CDN.
 *
 * Why pre-render instead of auto-render in the WebView:
 * - Faster: no JS execution inside the WebView, only CSS layout.
 * - Deterministic: avoids CDN timing races where auto-render would run
 *   before katex.min.js had loaded, which made fractions show up
 *   inline instead of stacked.
 * - Same output as web/src/components/shared/math-text.tsx.
 *
 * Plain-text fast path: if the input contains no math/bold markers we
 * fall back to a plain <Text> node so simple labels (queue chips, etc)
 * don't pay the WebView cost.
 */

interface MathTextProps {
  text: string;
  style?: TextStyle;
  numberOfLines?: number;
  /**
   * Compact mode: wrapper shrinks to the WebView's measured content width
   * instead of filling parent (default `width: 100%`). Used for inline
   * chips/badges where a wide bubble around a small fraction would leave
   * dead space. Layout starts at INITIAL_COMPACT_W so KaTeX has room to
   * render; once `getBoundingClientRect()` reports the real content size
   * the wrapper resizes to it. `display: inline-block` on #content keeps
   * its intrinsic width after the parent shrinks.
   */
  compact?: boolean;
}

// Initial render width in compact mode — wide enough for most inline
// expressions ($\frac{a}{b}$, $x^2 + y^2$). After the WebView reports
// actual content width, the wrapper shrinks. If a chip's content is
// wider than this, it still renders correctly (inline-block doesn't
// constrain) but the first paint may briefly clip.
const INITIAL_COMPACT_W = 200;

// Single source of truth for the math/bold tokenizer. Use .test() directly
// (lastIndex is always 0 for a non-global regex) and create a fresh global
// clone in buildHtml() so matchAll() has its own iterator state.
//
// Inline `$...$` rejects content that starts with `<digit>+[\s,]` — that's
// dollar-denominated money in a word problem (e.g. `costs $5 and $10`,
// `$1,000`), not LaTeX. Without this guard the regex eats text between
// unrelated `$` signs and silently collapses to a KaTeX-fallback string
// with the dollars stripped (`costs 5 and 10`).
//
// `.` is intentionally NOT in the disallowed set so decimal LaTeX
// literals (`$3.14$`, `$5.5x$`, `$3.14 \times 2$`) still render as math.
const MATH_OR_BOLD_RE = /(\$\$[\s\S]+?\$\$|\$(?!\d+[\s,])[^$\n]+?\$|\*\*[^*]+\*\*)/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// \n is ambiguous with prose, so restore it only for real \n-commands. The
// 1-char-suffix ones (\ne, \nu, \ni) collide most easily with a multiline-math
// row starting "e"/"u"/"i", so they're dropped; \neq, \nabla, etc. still restore.
const N_COMMANDS = new Set([
  "neq", "nabla", "not", "nmid", "nleq", "ngeq", "nless",
  "ngtr", "nparallel", "ncong", "nsim", "nsubseteq", "nsupseteq",
  "nrightarrow", "nleftarrow", "natural",
]);

function renderLatex(latex: string, displayMode: boolean): string {
  // Restore backslashes the JSON pipeline turned into control chars: when the
  // API's `\\frac`/`\\times` get double-unescaped, `\f`/`\t`/`\r`/`\v`/`\b`
  // become control characters. Restore each before a letter run so katex sees
  // the real command. (Real control chars are meaningless in LaTeX.) The real
  // fix is on the backend — `_normalize_arrays` — this stays for legacy data.
  const fixed = latex
    .replace(/\r([a-zA-Z]+)/g, "\\r$1")
    .replace(/\t([a-zA-Z]+)/g, "\\t$1")
    .replace(/\f([a-zA-Z]+)/g, "\\f$1")
    .replace(/\v([a-zA-Z]+)/g, "\\v$1")
    .replace(/\x08([a-zA-Z]+)/g, "\\b$1")
    .replace(/\n([a-zA-Z]+)/g, (m, run) => (N_COMMANDS.has("n" + run) ? "\\n" + run : m));
  try {
    return katex.renderToString(fixed, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return escapeHtml(fixed);
  }
}

// Inline math wrappers ($...$) that contain LaTeX environments (matrices,
// cases, aligned blocks, etc.) render badly inline — they're inherently
// multi-line / wide and clip in inline flow. Promote them to display mode
// so they get the .m-display block wrapper with overflow-x: auto.
const MULTILINE_ENV_RE = /\\begin\{(p|b|v|V|B|small)?matrix\b|\\begin\{cases\b|\\begin\{align(ed)?\*?\b|\\begin\{array\b/;

function buildHtml(text: string, color: string, fontSize: number, fontWeight: string, compact = false): string {
  const parts: string[] = [];
  const pattern = new RegExp(MATH_OR_BOLD_RE.source, "g");
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index!;
    if (idx > last) {
      parts.push(escapeHtml(text.slice(last, idx)).replace(/\n/g, "<br>"));
    }
    const seg = m[0];
    if (seg.startsWith("$$") && seg.endsWith("$$")) {
      parts.push(`<div class="m-display">${renderLatex(seg.slice(2, -2).trim(), true)}</div>`);
    } else if (seg.startsWith("$") && seg.endsWith("$")) {
      const inner = seg.slice(1, -1).trim();
      if (MULTILINE_ENV_RE.test(inner)) {
        parts.push(`<div class="m-display">${renderLatex(inner, true)}</div>`);
      } else {
        parts.push(renderLatex(inner, false));
      }
    } else if (seg.startsWith("**") && seg.endsWith("**")) {
      parts.push(`<strong>${escapeHtml(seg.slice(2, -2))}</strong>`);
    }
    last = idx + seg.length;
  }
  if (last < text.length) {
    parts.push(escapeHtml(text.slice(last)).replace(/\n/g, "<br>"));
  }
  const body = parts.join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${KATEX_CSS}</style>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${color};
    font-size: ${fontSize}px;
    font-weight: ${fontWeight};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.45;
    overflow: hidden;
    word-wrap: break-word;
    -webkit-text-size-adjust: 100%;
  }
  .m-display { display: block; margin: 8px 0; overflow-x: auto; text-align: center; }
  .katex { font-size: 1.05em !important; }
  .katex-display { margin: 8px 0 !important; text-align: center; }
  strong { font-weight: 700; }
</style>
</head>
<body>
<div id="content"${compact ? ' style="display:inline-block;"' : ''}>${body}</div>
<script>
  var lastW = 0, lastH = 0;
  function postSize() {
    var el = document.getElementById('content');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var w = Math.ceil(rect.width);
    var h = Math.ceil(rect.height);
    if (h > 0 && (h !== lastH || w !== lastW) && window.ReactNativeWebView) {
      lastH = h;
      lastW = w;
      window.ReactNativeWebView.postMessage(JSON.stringify({w: w, h: h}));
    }
  }
  function init() {
    postSize();
    // ResizeObserver fires once after layout and then only when the
    // content box actually changes — far fewer round-trips than the
    // previous fixed-delay polling. Webkit on iOS has had it since 13.4.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(postSize).observe(document.getElementById('content'));
    }
    // Fallback: fonts.ready catches late-loading KaTeX webfonts on
    // platforms where ResizeObserver doesn't cover font metric changes.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(postSize);
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
</script>
</body>
</html>`;
}

export function MathText({ text, style, numberOfLines, compact }: MathTextProps) {
  const colors = useColors();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 20 });

  // All hooks must run unconditionally on every render — React tracks them
  // by call order. Previously, useMemo lived below the empty-text and
  // plain-text early returns, so any MathText instance whose `text` prop
  // transitioned between plain and math would grow its hook count and
  // trigger "Rendered more hooks than during the previous render."
  const hasMath = !!text && MATH_OR_BOLD_RE.test(text);
  const color = (style?.color as string) ?? colors.text;
  const fontSize = (style?.fontSize as number) ?? 14;
  const fontWeight = String(style?.fontWeight ?? "400");

  const html = useMemo(
    () => (hasMath ? buildHtml(text, color, fontSize, fontWeight, compact) : ""),
    [hasMath, text, color, fontSize, fontWeight, compact],
  );

  const defaultTextStyle = useMemo<TextStyle>(
    () => ({ ...typography.body, color: colors.text }),
    [colors.text],
  );

  if (!text) return null;

  // Plain text fast path — skips the WebView cost entirely.
  if (!hasMath) {
    return (
      <Text style={style ?? defaultTextStyle} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  // Compact mode: shrink wrapper to measured content width. Until the
  // first {w,h} message arrives, render at INITIAL_COMPACT_W so KaTeX
  // has horizontal room. Non-compact keeps the legacy width:100% behavior.
  const wrapStyle = compact
    ? { width: size.w || INITIAL_COMPACT_W, height: size.h }
    : { height: size.h };

  return (
    <View style={[compact ? styles.webviewWrapCompact : styles.webviewWrap, wrapStyle]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        backgroundColor="transparent"
        automaticallyAdjustContentInsets={false}
        onMessage={(e) => {
          try {
            const { w, h } = JSON.parse(e.nativeEvent.data);
            if (typeof h !== "number" || h <= 0) return;
            setSize((prev) => {
              const nextW = compact && typeof w === "number" && w > 0 ? w : prev.w;
              if (Math.abs(prev.h - h) <= 1 && Math.abs(prev.w - nextW) <= 1) return prev;
              return { w: nextW, h };
            });
          } catch {
            // ignore malformed payload
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webviewWrap: {
    width: "100%",
    backgroundColor: "transparent",
  },
  webviewWrapCompact: {
    backgroundColor: "transparent",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
