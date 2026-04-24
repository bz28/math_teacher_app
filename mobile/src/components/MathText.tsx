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
}

// Single source of truth for the math/bold tokenizer. Use .test() directly
// (lastIndex is always 0 for a non-global regex) and create a fresh global
// clone in buildHtml() so matchAll() has its own iterator state.
const MATH_OR_BOLD_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+\*\*)/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderLatex(latex: string, displayMode: boolean): string {
  // Fix lost backslashes: if `\t` was interpreted as a tab character by the
  // JS string pipeline (happens when the API JSON's `\\times` gets double-
  // unescaped), restore it so katex sees `\t` as the start of `\times`,
  // `\theta`, `\tau`, `\text{...}`, etc. Real tabs in LaTeX are meaningless.
  const fixed = latex.replace(/\t/g, "\\t");
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

function buildHtml(text: string, color: string, fontSize: number, fontWeight: string): string {
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
<div id="content">${body}</div>
<script>
  var lastH = 0;
  function postHeight() {
    var el = document.getElementById('content');
    if (!el) return;
    var h = Math.ceil(el.getBoundingClientRect().height);
    if (h > 0 && h !== lastH && window.ReactNativeWebView) {
      lastH = h;
      window.ReactNativeWebView.postMessage(String(h));
    }
  }
  function init() {
    postHeight();
    // ResizeObserver fires once after layout and then only when the
    // content box actually changes — far fewer round-trips than the
    // previous fixed-delay polling. Webkit on iOS has had it since 13.4.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(postHeight).observe(document.getElementById('content'));
    }
    // Fallback: fonts.ready catches late-loading KaTeX webfonts on
    // platforms where ResizeObserver doesn't cover font metric changes.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(postHeight);
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
</script>
</body>
</html>`;
}

export function MathText({ text, style, numberOfLines }: MathTextProps) {
  const colors = useColors();
  const [height, setHeight] = useState(20);

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
    () => (hasMath ? buildHtml(text, color, fontSize, fontWeight) : ""),
    [hasMath, text, color, fontSize, fontWeight],
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

  return (
    <View style={[styles.webviewWrap, { height }]}>
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
          const h = parseInt(e.nativeEvent.data, 10);
          if (!isNaN(h) && h > 0 && Math.abs(h - height) > 1) setHeight(h);
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
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
