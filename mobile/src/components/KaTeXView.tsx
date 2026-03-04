import React, { useRef, useCallback, memo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

const KATEX_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <style>
    body { margin: 0; padding: 8px; background: transparent; display: flex; align-items: center; justify-content: center; }
    #math { font-size: 18px; text-align: center; }
  </style>
</head>
<body>
  <div id="math"></div>
  <script>
    function render(latex, displayMode) {
      try {
        katex.render(latex, document.getElementById('math'), {
          displayMode: displayMode,
          throwOnError: false,
          trust: false,
        });
        const height = document.getElementById('math').offsetHeight + 16;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: height }));
      } catch (e) {
        document.getElementById('math').textContent = latex;
      }
    }
  </script>
</body>
</html>
`;

interface KaTeXViewProps {
  latex: string;
  displayMode?: boolean;
}

export const KaTeXView = memo(function KaTeXView({
  latex,
  displayMode = false,
}: KaTeXViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [height, setHeight] = React.useState(40);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === "height") {
      setHeight(data.value);
    }
  }, []);

  const injectedJS = `render(${JSON.stringify(latex)}, ${displayMode}); true;`;

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        ref={webViewRef}
        source={{ html: KATEX_HTML }}
        style={styles.webview}
        scrollEnabled={false}
        injectedJavaScript={injectedJS}
        onMessage={onMessage}
        originWhitelist={["*"]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { overflow: "hidden", width: "100%" },
  webview: { backgroundColor: "transparent", flex: 1 },
});
