import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

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
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>{"< Back"}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Choose a Mode</Text>
      <Text style={styles.subtitle}>How would you like to study?</Text>

      <View style={styles.list}>
        {MODES.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            style={styles.card}
            onPress={() => onSelect(mode.id)}
          >
            <Text style={styles.icon}>{mode.icon}</Text>
            <View style={styles.cardText}>
              <Text style={styles.label}>{mode.label}</Text>
              <Text style={styles.description}>{mode.description}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  backButton: { alignSelf: "flex-start", marginBottom: 24 },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 32 },
  list: { gap: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F4FF",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "#4A90D9",
  },
  icon: { fontSize: 32, marginRight: 16 },
  cardText: { flex: 1 },
  label: { fontSize: 18, fontWeight: "600", color: "#333", marginBottom: 4 },
  description: { fontSize: 14, color: "#666" },
});
