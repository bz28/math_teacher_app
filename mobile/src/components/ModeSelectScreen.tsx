import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export type Mode = "learn" | "practice" | "mock_exam";

interface ModeSelectScreenProps {
  onSelect: (mode: Mode) => void;
  onBack: () => void;
}

const MODES: { id: Mode; label: string; icon: string; description: string }[] = [
  {
    id: "learn",
    label: "Learn",
    icon: "📖",
    description: "Step-by-step guided learning",
  },
  {
    id: "practice",
    label: "Practice",
    icon: "✏️",
    description: "Solve problems on your own",
  },
  {
    id: "mock_exam",
    label: "Mock Exam",
    icon: "📝",
    description: "Timed exam simulation",
  },
];

export function ModeSelectScreen({ onSelect, onBack }: ModeSelectScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>{"\u2039"} Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Choose a Mode</Text>
        <Text style={styles.subtitle}>How would you like to study?</Text>
      </View>

      <View style={styles.list}>
        {MODES.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            style={styles.card}
            onPress={() => onSelect(mode.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.icon}>{mode.icon}</Text>
            <View style={styles.cardText}>
              <Text style={styles.label}>{mode.label}</Text>
              <Text style={styles.description}>{mode.description}</Text>
            </View>
            <Text style={styles.chevron}>{"\u203A"}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 28,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 16,
    marginBottom: 8,
  },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: "#888",
    lineHeight: 22,
  },
  list: { gap: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: "#E8EBF0",
  },
  icon: { fontSize: 30, marginRight: 16 },
  cardText: { flex: 1 },
  label: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", marginBottom: 4 },
  description: { fontSize: 14, color: "#888", lineHeight: 20 },
  chevron: { fontSize: 24, color: "#C0C4CC", fontWeight: "300" },
});
