import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface HomeScreenProps {
  onSelect: (subject: string) => void;
  onLogout: () => void;
}

const SUBJECTS = [
  { id: "math", label: "Math", icon: "calculator-outline" as const },
] as const;

export function HomeScreen({ onSelect, onLogout }: HomeScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <AnimatedPressable style={styles.logoutButton} onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out">
          <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.logoutText}>Log Out</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.center}>
        <Text style={styles.greeting}>Hi there!</Text>
        <Text style={styles.subtitle}>What subject would you like to study?</Text>

        <View style={styles.grid}>
          {SUBJECTS.map((subject) => (
            <AnimatedPressable
              key={subject.id}
              style={[styles.card, shadows.lg]}
              onPress={() => onSelect(subject.id)}
              scaleDown={0.94}
              accessibilityRole="button"
              accessibilityLabel={`Study ${subject.label}`}
            >
              <LinearGradient
                colors={gradients.primary}
                style={styles.iconCircle}
              >
                <Ionicons name={subject.icon} size={32} color={colors.white} />
              </LinearGradient>
              <Text style={styles.label}>{subject.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: spacing.sm,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  logoutText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  greeting: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: 36,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.lg,
  },
  card: {
    width: 160,
    height: 160,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  label: { ...typography.bodyBold, fontSize: 17, color: colors.text },
});
