import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

/**
 * Renders a problem's `figure_svg` in a transparent, auto-height WebView —
 * the same WebView approach MathText uses, since SVG needs real layout. The
 * page reports its height back so the native view sizes to the figure.
 */
export function FigureSvg({ svg }: { svg: string }) {
  const [height, setHeight] = useState(160);
  const html = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>html,body{margin:0;padding:0;background:transparent}#w{display:flex;justify-content:center}svg{max-width:100%;height:auto}</style></head>` +
      `<body><div id="w">${svg}</div>` +
      `<script>function r(){var h=document.getElementById('w').scrollHeight;if(h&&window.ReactNativeWebView){window.ReactNativeWebView.postMessage(String(h))}}window.onload=r;setTimeout(r,80)</script></body></html>`,
    [svg],
  );
  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        onMessage={(e) => {
          const h = Number(e.nativeEvent.data);
          if (h > 0) setHeight(Math.ceil(h));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  web: { flex: 1, backgroundColor: "transparent" },
});
