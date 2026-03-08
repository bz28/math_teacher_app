import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface OnboardingScreenProps {
  onComplete: () => void;
}

type Step = "welcome" | "modes";
const STEPS: Step[] = ["welcome", "modes"];

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.progressRow}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === stepIndex && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.content}>
        {step === "welcome" && <WelcomeStep />}
        {step === "modes" && <ModesStep />}
      </View>

      {/* Navigation */}
      <View style={styles.nav}>
        {stepIndex > 0 ? (
          <AnimatedPressable onPress={handleBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
        ) : (
          <View />
        )}

        <AnimatedPressable onPress={handleNext}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.nextButton}
          >
            <Text style={styles.nextText}>
              {isLast ? "Get Started" : "Continue"}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </LinearGradient>
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

/* -- Step Components -- */

function WelcomeStep() {
  return (
    <View style={styles.stepCenter}>
      <View style={styles.heroIconWrap}>
        <LinearGradient
          colors={gradients.primary}
          style={styles.heroIconGradient}
        >
          <Ionicons name="school" size={48} color={colors.white} />
        </LinearGradient>
      </View>
      <Text style={styles.welcomeTitle}>Welcome to Math Tutor</Text>
      <Text style={styles.welcomeSubtitle}>
        Learn math step-by-step, at your pace.
      </Text>
      <View style={styles.featureList}>
        <FeatureRow
          icon="bulb-outline"
          text="Get guided through each step — never just the answer"
        />
        <FeatureRow
          icon="checkmark-circle-outline"
          text="Practice with similar problems until you've got it"
        />
        <FeatureRow
          icon="chatbubble-ellipses-outline"
          text="Ask questions anytime — your AI tutor is always here"
        />
      </View>
    </View>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIconWrap}>
        <Ionicons name={icon as any} size={22} color={colors.primary} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function ModesStep() {
  return (
    <View style={styles.stepTop}>
      <Text style={styles.stepTitle}>Two ways to study</Text>
      <Text style={styles.stepSubtitle}>Use both to master any topic.</Text>

      <View style={[styles.modeCard, shadows.md]}>
        <View style={[styles.modeIconWrap, { backgroundColor: colors.primaryBg }]}>
          <Ionicons name="book-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeLabel}>Learn Mode</Text>
          <Text style={styles.modeDesc}>
            We break the problem into steps and guide you through each one.
            Hints start vague and get more specific — you always do the
            thinking.
          </Text>
        </View>
      </View>

      <View style={[styles.modeCard, shadows.md]}>
        <View style={[styles.modeIconWrap, { backgroundColor: colors.successLight }]}>
          <Ionicons name="pencil-outline" size={24} color={colors.success} />
        </View>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeLabel}>Practice Mode</Text>
          <Text style={styles.modeDesc}>
            Solve similar problems on your own to build confidence. Flag
            anything tricky and revisit it in Learn mode.
          </Text>
        </View>
      </View>

      <Text style={styles.readyText}>
        Create an account to start learning!
      </Text>
    </View>
  );
}

/* -- Styles -- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl,
  },

  // Progress
  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
    borderRadius: radii.pill,
  },

  // Content
  content: {
    flex: 1,
    justifyContent: "center",
  },

  // Navigation
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 14,
  },
  nextText: { color: colors.white, ...typography.button },

  // Welcome
  stepCenter: {
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  heroIconWrap: {
    marginBottom: spacing.xl,
  },
  heroIconGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  welcomeTitle: {
    ...typography.hero,
    textAlign: "center",
    marginBottom: spacing.sm,
    color: colors.text,
  },
  welcomeSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xxxl,
  },
  featureList: { gap: spacing.xl, width: "100%" },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
  },
  featureText: { ...typography.body, color: colors.textSecondary, flex: 1 },

  // Modes
  stepTop: { paddingTop: spacing.lg },
  stepTitle: {
    ...typography.title,
    marginBottom: spacing.sm,
    color: colors.text,
  },
  stepSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
  },
  modeCard: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: "flex-start",
  },
  modeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  modeTextWrap: { flex: 1 },
  modeLabel: {
    ...typography.heading,
    fontSize: 18,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modeDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  readyText: {
    ...typography.bodyBold,
    color: colors.primary,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
