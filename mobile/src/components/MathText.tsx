import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TextStyle, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, typography } from "../theme";

/**
 * Mobile MathText — renders a string that may contain inline LaTeX
 * (`$...$`), display LaTeX (`$$...$$`), and bold markdown (`**...**`)
 * the same way the web MathText component does, by injecting the
 * content into a WebView with KaTeX from a CDN.
 *
 * Implementation notes:
 * - One WebView per MathText instance. The HTML uses KaTeX from jsdelivr
 *   and reports its rendered content height back to React Native via
 *   window.ReactNativeWebView.postMessage so the WebView can be sized
 *   precisely (no internal scroll, no extra whitespace).
 * - If the input contains no math/bold markers, we fall back to a
 *   plain `<Text>` to avoid the cost of spinning up a WebView for
 *   simple text (e.g. queue chips).
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

function buildHtml(text: string, color: string, fontSize: number, fontWeight: string): string {
  // Escape HTML in non-math segments only; pass math segments through verbatim
  // so KaTeX can parse them.
  const parts: string[] = [];
  const pattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index!;
    if (idx > last) parts.push(escapeHtml(text.slice(last, idx)));
    const seg = m[0];
    if (seg.startsWith("$$") && seg.endsWith("$$")) {
      parts.push(`<span class="m-display">$$${seg.slice(2, -2)}$$</span>`);
    } else if (seg.startsWith("$") && seg.endsWith("$")) {
      parts.push(`<span class="m-inline">$${seg.slice(1, -1)}$</span>`);
    } else if (seg.startsWith("**") && seg.endsWith("**")) {
      parts.push(`<strong>${escapeHtml(seg.slice(2, -2))}</strong>`);
    }
    last = idx + seg.length;
  }
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  const body = parts.join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${color};
    font-size: ${fontSize}px;
    font-weight: ${fontWeight};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.4;
    overflow: hidden;
    word-wrap: break-word;
  }
  .m-display { display: block; margin: 6px 0; overflow-x: auto; }
  .katex { font-size: 1em !important; }
  .katex-display { margin: 6px 0 !important; }
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
  function render() {
    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false
      });
    }
    setTimeout(postHeight, 30);
    setTimeout(postHeight, 200);
  }
  if (document.readyState === 'complete') render();
  else window.addEventListener('load', render);
</script>
</body>
</html>`;
}

export function MathText({ text, style, numberOfLines }: MathTextProps) {
  const [height, setHeight] = useState(20);

  if (!text) return null;

  const hasMath = HAS_MATH_OR_BOLD.test(text);

  // Plain text fast path — no WebView, just a Text node
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
