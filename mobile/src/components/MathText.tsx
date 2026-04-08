import { useMemo, useState } from "react";
import { StyleSheet, Text, TextStyle, View } from "react-native";
import { WebView } from "react-native-webview";
import katex from "katex";
import { colors, typography } from "../theme";

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

const HAS_MATH_OR_BOLD = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+\*\*)/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderLatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return escapeHtml(latex);
  }
}

function buildHtml(text: string, color: string, fontSize: number, fontWeight: string): string {
  const parts: string[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+\*\*)/g;
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
      parts.push(renderLatex(seg.slice(1, -1).trim(), false));
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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
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
  function postHeight() {
    var h = document.getElementById('content').getBoundingClientRect().height;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(String(Math.ceil(h)));
    }
  }
  // Report height once the stylesheet has applied
  function init() {
    postHeight();
    setTimeout(postHeight, 100);
    setTimeout(postHeight, 400);
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
  // Also report on font / image / stylesheet load
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(postHeight);
</script>
</body>
</html>`;
}

export function MathText({ text, style, numberOfLines }: MathTextProps) {
  const [height, setHeight] = useState(20);

  if (!text) return null;

  const hasMath = HAS_MATH_OR_BOLD.test(text);

  // Plain text fast path
  if (!hasMath) {
    return (
      <Text style={style ?? defaultTextStyle} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  const color = (style?.color as string) ?? colors.text;
  const fontSize = (style?.fontSize as number) ?? 14;
  const fontWeight = String(style?.fontWeight ?? "400");

  const html = useMemo(
    () => buildHtml(text, color, fontSize, fontWeight),
    [text, color, fontSize, fontWeight],
  );

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

const defaultTextStyle: TextStyle = {
  ...typography.body,
  color: colors.text,
};

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
