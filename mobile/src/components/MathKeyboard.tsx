import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface MathKeyboardProps {
  onInsert: (value: string) => void;
}

const KEYS = [
  { label: "x", value: "x" },
  { label: "^", value: "^" },
  { label: "(", value: "(" },
  { label: ")", value: ")" },
  { label: "/", value: "/" },
  { label: "\u221A", value: "sqrt(" },
  { label: "=", value: "=" },
  { label: "\u00D7", value: "*" },
  { label: "+", value: "+" },
  { label: "\u2212", value: "-" },
];

export function MathKeyboard({ onInsert }: MathKeyboardProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 4,
  },
  key: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 44,
    alignItems: "center",
  },
  keyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
});
