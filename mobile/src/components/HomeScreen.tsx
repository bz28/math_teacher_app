import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { PaywallScreen } from "./PaywallScreen";
import { getUserName } from "../services/api";
import { useEntitlementStore } from "../stores/entitlements";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface HomeScreenProps {
  onSelect: (subject: string) => void;
  onLogout: () => void;
  onAccount?: () => void;
}

export function HomeScreen({ onSelect, onLogout, onAccount }: HomeScreenProps) {
  const name = getUserName();
  const greeting = name ? `Hi, ${name}!` : "Hi there!";
  const isPro = useEntitlementStore((s) => s.isPro);
  const [paywallVisible, setPaywallVisible] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <LinearGradient colors={gradients.primary} style={styles.logoCircle}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.white }}>V</Text>
          </LinearGradient>
          <Text style={styles.appName}>Veradic AI</Text>
        </View>
        <AnimatedPressable
          style={styles.profileButton}
          onPress={onAccount ?? onLogout}
          accessibilityRole="button"
          accessibilityLabel="Account"
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

      {/* Upgrade card — only for free users */}
      {!isPro && (
        <AnimatedPressable
          style={[styles.upgradeCard, shadows.sm]}
          onPress={() => setPaywallVisible(true)}
          scaleDown={0.97}
        >
          <View style={styles.upgradeContent}>
            <View style={styles.upgradeTextWrap}>
              <View style={styles.upgradeHeaderRow}>
                <Ionicons name="star" size={18} color={colors.warning} />
                <Text style={styles.upgradeTitle}>Upgrade to Pro</Text>
              </View>
              <Text style={styles.upgradeDesc}>Unlimited sessions, mock tests & more</Text>
            </View>
            <View style={styles.upgradeCta}>
              <Text style={styles.upgradeCtaText}>Try Free</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.primary} />
            </View>
          </View>
        </AnimatedPressable>
      )}

      <PaywallScreen
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPurchaseComplete={() => setPaywallVisible(false)}
        trigger="home_upgrade_card"
      />
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

  // Upgrade card
  upgradeCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  upgradeContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  upgradeTextWrap: {
    flex: 1,
  },
  upgradeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  upgradeTitle: {
    ...typography.bodyBold,
    color: colors.text,
  },
  upgradeDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  upgradeCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  upgradeCtaText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
  },
});
