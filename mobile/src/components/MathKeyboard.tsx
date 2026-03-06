import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface MathKeyboardProps {
  onInsert: (value: string) => void;
}

const KEYS = [
  { label: "+", value: "+" },
  { label: "\u2212", value: "-" },
  { label: "*", value: "*" },
  { label: "/", value: "/" },
  { label: "^", value: "^" },
  { label: "(", value: "(" },
  { label: ")", value: ")" },
  { label: "=", value: "=" },
  { label: "\u221A", value: "sqrt(" },
  { label: "x", value: "x" },
];

export function MathKeyboard({ onInsert }: MathKeyboardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {KEYS.map((key) => (
          <TouchableOpacity
            key={key.label}
            style={styles.key}
            onPress={() => onInsert(key.value)}
            accessibilityLabel={`Insert ${key.label}`}
          >
            <Text style={styles.keyText}>{key.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingVertical: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  key: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    paddingVertical: 10,
    minWidth: 56,
    width: "17%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  keyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
});
