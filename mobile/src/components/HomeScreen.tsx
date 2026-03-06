import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface HomeScreenProps {
  onSelect: (subject: string) => void;
  onLogout: () => void;
}

const SUBJECTS = [
  { id: "math", label: "Math", icon: "+" },
] as const;

export function HomeScreen({ onSelect, onLogout }: HomeScreenProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <Text style={styles.greeting}>Hi there!</Text>
      <Text style={styles.subtitle}>What subject would you like to study?</Text>

      <View style={styles.grid}>
        {SUBJECTS.map((subject) => (
          <TouchableOpacity
            key={subject.id}
            style={styles.card}
            onPress={() => onSelect(subject.id)}
          >
            <Text style={styles.icon}>{subject.icon}</Text>
            <Text style={styles.label}>{subject.label}</Text>
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  logoutButton: { position: "absolute", top: 60, right: 24 },
  logoutText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  greeting: { fontSize: 28, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 32 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 16,
  },
  card: {
    width: 140,
    height: 140,
    backgroundColor: "#F0F4FF",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#4A90D9",
  },
  icon: { fontSize: 36, marginBottom: 8, color: "#4A90D9" },
  label: { fontSize: 18, fontWeight: "600", color: "#333" },
});
