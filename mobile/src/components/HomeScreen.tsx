import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { getUserName } from "../services/api";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface HomeScreenProps {
  onSelect: (subject: string) => void;
  onLogout: () => void;
}

export function HomeScreen({ onSelect, onLogout }: HomeScreenProps) {
  const name = getUserName();
  const greeting = name ? `Hi, ${name}!` : "Hi there!";

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <LinearGradient colors={gradients.primary} style={styles.logoCircle}>
            <Ionicons name="school" size={18} color={colors.white} />
          </LinearGradient>
          <Text style={styles.appName}>Math Tutor</Text>
        </View>
        <AnimatedPressable
          style={styles.profileButton}
          onPress={onLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Ionicons name="person-circle-outline" size={28} color={colors.textMuted} />
        </AnimatedPressable>
      </View>

      {/* Greeting */}
      <View style={styles.greetingSection}>
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.subtitle}>Ready to learn something new?</Text>
      </View>

      {/* Subject card */}
      <Text style={styles.sectionLabel}>SUBJECTS</Text>
      <AnimatedPressable
        style={[styles.subjectCard, shadows.md]}
        onPress={() => onSelect("math")}
        scaleDown={0.97}
        accessibilityRole="button"
        accessibilityLabel="Study Math"
      >
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.subjectGradient}
        >
          <View style={styles.subjectContent}>
            <View style={styles.subjectIconWrap}>
              <Ionicons name="calculator" size={28} color={colors.white} />
            </View>
            <View style={styles.subjectTextWrap}>
              <Text style={styles.subjectTitle}>Mathematics</Text>
              <Text style={styles.subjectDesc}>
                Algebra, equations, word problems, and more
              </Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.7)" />
          </View>
        </LinearGradient>
      </AnimatedPressable>

      <AnimatedPressable
        style={[styles.subjectCard, shadows.md, { marginTop: spacing.md }]}
        onPress={() => onSelect("chemistry")}
        scaleDown={0.97}
        accessibilityRole="button"
        accessibilityLabel="Study Chemistry"
      >
        <LinearGradient
          colors={gradients.chemistry}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.subjectGradient}
        >
          <View style={styles.subjectContent}>
            <View style={styles.subjectIconWrap}>
              <Ionicons name="flask" size={28} color={colors.white} />
            </View>
            <View style={styles.subjectTextWrap}>
              <Text style={styles.subjectTitle}>Chemistry</Text>
              <Text style={styles.subjectDesc}>
                Reactions, balancing equations, stoichiometry, and more
              </Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.7)" />
          </View>
        </LinearGradient>
      </AnimatedPressable>

      {/* Quick tips / what you can do */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.xxxl }]}>WHAT YOU CAN DO</Text>
      <View style={styles.tipGrid}>
        <View style={[styles.tipCard, shadows.sm]}>
          <Ionicons name="camera-outline" size={22} color={colors.primary} />
          <Text style={styles.tipText}>Snap a photo of any problem</Text>
        </View>
        <View style={[styles.tipCard, shadows.sm]}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
          <Text style={styles.tipText}>Chat with your AI tutor</Text>
        </View>
        <View style={[styles.tipCard, shadows.sm]}>
          <Ionicons name="infinite-outline" size={22} color={colors.primary} />
          <Text style={styles.tipText}>Generate endless practice</Text>
        </View>
        <View style={[styles.tipCard, shadows.sm]}>
          <Ionicons name="document-text-outline" size={22} color={colors.primary} />
          <Text style={styles.tipText}>Take timed mock exams</Text>
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

  // Top bar
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  topBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  appName: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 17,
  },
  profileButton: {
    padding: spacing.xs,
  },

  // Greeting
  greetingSection: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  greeting: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },

  // Section label
  sectionLabel: {
    ...typography.small,
    color: colors.textMuted,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },

  // Subject card
  subjectCard: {
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  subjectGradient: {
    borderRadius: radii.xl,
    padding: spacing.xl,
  },
  subjectContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  subjectIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.lg,
  },
  subjectTextWrap: {
    flex: 1,
  },
  subjectTitle: {
    ...typography.heading,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  subjectDesc: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
    lineHeight: 18,
  },

  // Tips grid
  tipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  tipCard: {
    width: "47%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  tipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
});
