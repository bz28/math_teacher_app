import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface HomeScreenProps {
  onSelect: (subject: string) => void;
  onLogout: () => void;
}

const SUBJECTS = [
  { id: "math", label: "Math", icon: "+" },
] as const;

export function HomeScreen({ onSelect, onLogout }: HomeScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.center}>
        <Text style={styles.greeting}>Hi there!</Text>
        <Text style={styles.subtitle}>What subject would you like to study?</Text>

        <View style={styles.grid}>
          {SUBJECTS.map((subject) => (
            <TouchableOpacity
              key={subject.id}
              style={styles.card}
              onPress={() => onSelect(subject.id)}
              activeOpacity={0.7}
            >
              <View style={styles.iconCircle}>
                <Text style={styles.icon}>{subject.icon}</Text>
              </View>
              <Text style={styles.label}>{subject.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 8,
  },
  logoutButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
  },
  logoutText: { color: "#888", fontSize: 14, fontWeight: "600" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  greeting: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    marginBottom: 36,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 16,
  },
  card: {
    width: 150,
    height: 150,
    backgroundColor: "#F7F8FA",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E8EBF0",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#EBF2FC",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  icon: { fontSize: 28, color: "#4A90D9", fontWeight: "700" },
  label: { fontSize: 17, fontWeight: "600", color: "#333" },
});
