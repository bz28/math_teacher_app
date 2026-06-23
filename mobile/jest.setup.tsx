/* Global mocks so screen/component tests can render in-process without the
   native runtime. The API layer is mocked per-test (jest.mock) since each
   screen drives different endpoints. */

// React 19 requires this flag for React Native Testing Library's act() support.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Haptics: no-op, but keep the enums the screens reference.
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// WebView is only used inside MathText/FigureSvg; stub it so math/figures
// don't pull a real browser engine into the test renderer.
jest.mock("react-native-webview", () => ({ WebView: () => null }));

// Vector icons pull expo-font's native loader (unresolvable in jest). Stub
// every icon set to a simple text node carrying the icon name.
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Icon = (props: { name?: string }) => React.createElement(Text, null, props.name ?? "icon");
  return new Proxy({}, { get: () => Icon });
});

// Render MathText as plain text so tests assert on question/answer content
// without the KaTeX/WebView path. (require inside the factory — jest.mock is
// hoisted above imports, so it can't close over module-scope variables.)
jest.mock("./src/components/MathText", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return { MathText: ({ text }: { text: string }) => React.createElement(Text, null, text) };
});
