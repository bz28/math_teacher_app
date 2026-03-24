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

type Step = "welcome" | "capture" | "learn" | "practice";
const STEPS: Step[] = ["welcome", "capture", "learn", "practice"];

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
        {step === "capture" && <CaptureStep />}
        {step === "learn" && <LearnStep />}
        {step === "practice" && <PracticeStep />}
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
          <Ionicons name="school" size={40} color={colors.white} />
        </LinearGradient>
      </View>
      <Text style={styles.welcomeTitle}>Welcome to{"\n"}Math Tutor</Text>
      <Text style={styles.stepSubtitle}>
        Your personal AI tutor that teaches you how to solve problems with endless practice
      </Text>
      <View style={styles.welcomeFeatures}>
        <View style={styles.welcomeFeatureRow}>
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
          <Text style={styles.welcomeFeatureText}>Snap a photo of any problem</Text>
        </View>
        <View style={styles.welcomeFeatureRow}>
          <Ionicons name="bulb-outline" size={20} color={colors.primary} />
          <Text style={styles.welcomeFeatureText}>Get guided step by step</Text>
        </View>
        <View style={styles.welcomeFeatureRow}>
          <Ionicons name="infinite-outline" size={20} color={colors.primary} />
          <Text style={styles.welcomeFeatureText}>Endless practice from one problem</Text>
        </View>
        <View style={styles.welcomeFeatureRow}>
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
          <Text style={styles.welcomeFeatureText}>Take timed mock exams</Text>
        </View>
      </View>
    </View>
  );
}

function CaptureStep() {
  return (
    <View style={styles.stepCenter}>
      <View style={styles.heroIconWrap}>
        <LinearGradient
          colors={gradients.primary}
          style={styles.heroIconGradient}
        >
          <Ionicons name="camera" size={40} color={colors.white} />
        </LinearGradient>
      </View>
      <Text style={styles.stepTitle}>Snap your homework</Text>
      <Text style={styles.stepSubtitle}>
        Take a photo and we'll extract every problem automatically
      </Text>

      {/* Mini mockup: extracted problems */}
      <View style={[styles.mockupCard, shadows.md]}>
        <View style={styles.mockupHeader}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.mockupHeaderText}>3 problems found</Text>
        </View>
        {["2x + 5 = 13", "x² - 4 = 0", "3x/4 + 2 = 8"].map((problem, i) => (
          <View key={i} style={styles.mockupRow}>
            <View style={styles.mockupCheckbox}>
              <Ionicons name="checkmark" size={12} color={colors.white} />
            </View>
            <Text style={styles.mockupProblem}>{problem}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function LearnStep() {
  return (
    <View style={styles.stepCenter}>
      <View style={styles.heroIconWrap}>
        <LinearGradient
          colors={gradients.primary}
          style={styles.heroIconGradient}
        >
          <Ionicons name="book" size={40} color={colors.white} />
        </LinearGradient>
      </View>
      <Text style={styles.stepTitle}>Learn how to solve it</Text>
      <Text style={styles.stepSubtitle}>
        We break every problem into steps — ask questions anytime and chat with your AI tutor
      </Text>

      {/* Mini mockup: step-by-step walkthrough */}
      <View style={[styles.mockupCard, shadows.md]}>
        <View style={styles.mockupStep}>
          <View style={[styles.mockupStepDot, styles.mockupStepDone]} />
          <View style={styles.mockupStepContent}>
            <Text style={styles.mockupStepLabel}>Step 1</Text>
            <Text style={styles.mockupStepText}>Subtract 5 from both sides</Text>
          </View>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        </View>
        <View style={styles.mockupStepLine} />
        <View style={styles.mockupStep}>
          <View style={[styles.mockupStepDot, styles.mockupStepActive]} />
          <View style={styles.mockupStepContent}>
            <Text style={[styles.mockupStepLabel, { color: colors.primary }]}>Step 2</Text>
            <Text style={styles.mockupStepText}>Divide both sides by 2</Text>
          </View>
        </View>
        <View style={styles.mockupHint}>
          <Ionicons name="chatbubble-ellipses" size={14} color={colors.primary} />
          <Text style={[styles.mockupHintText, { color: colors.primary }]}>Ask a question about this step</Text>
        </View>
      </View>
    </View>
  );
}

function PracticeStep() {
  return (
    <View style={styles.stepCenter}>
      <View style={styles.heroIconWrap}>
        <LinearGradient
          colors={gradients.success}
          style={styles.heroIconGradient}
        >
          <Ionicons name="infinite" size={40} color={colors.white} />
        </LinearGradient>
      </View>
      <Text style={styles.stepTitle}>One problem, endless practice</Text>
      <Text style={styles.stepSubtitle}>
        We generate similar problems so you can practice until you've truly got it
      </Text>

      {/* Mini mockup: one problem → many similar */}
      <View style={[styles.mockupCard, shadows.md]}>
        <Text style={styles.mockupSeedLabel}>Your problem</Text>
        <View style={styles.mockupSeedRow}>
          <Text style={styles.mockupSeedProblem}>2x + 5 = 13</Text>
        </View>

        <View style={styles.mockupArrowRow}>
          <View style={styles.mockupArrowLine} />
          <View style={styles.mockupArrowBadge}>
            <Ionicons name="sparkles" size={14} color={colors.primary} />
            <Text style={styles.mockupArrowText}>Generated for you</Text>
          </View>
          <View style={styles.mockupArrowLine} />
        </View>

        {["3x - 2 = 7", "5x + 1 = 21", "4x - 3 = 17"].map((problem, i) => (
          <View key={i} style={styles.mockupGeneratedRow}>
            <View style={[styles.mockupGeneratedDot, { backgroundColor: i === 0 ? colors.success : i === 1 ? colors.success : colors.primaryBg }]} />
            <Text style={styles.mockupGeneratedProblem}>{problem}</Text>
            {i < 2 && <Ionicons name="checkmark-circle" size={16} color={colors.success} />}
          </View>
        ))}
      </View>
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

  // Shared step styles
  stepCenter: {
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },
  heroIconWrap: {
    marginBottom: spacing.xl,
  },
  heroIconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  stepTitle: {
    ...typography.title,
    textAlign: "center",
    marginBottom: spacing.sm,
    color: colors.text,
  },
  stepSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.sm,
  },

  // Welcome step
  welcomeTitle: {
    ...typography.hero,
    fontSize: 34,
    textAlign: "center",
    marginBottom: spacing.md,
    color: colors.text,
  },
  welcomeFeatures: {
    width: "100%",
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  welcomeFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  welcomeFeatureText: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
  },

  // Mockup card (shared)
  mockupCard: {
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xl,
  },

  // Capture step mockup
  mockupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  mockupHeaderText: {
    ...typography.bodyBold,
    color: colors.success,
    fontSize: 14,
  },
  mockupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  mockupCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  mockupProblem: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
  },

  // Learn step mockup
  mockupStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  mockupStepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  mockupStepDone: {
    backgroundColor: colors.success,
  },
  mockupStepActive: {
    backgroundColor: colors.primary,
  },
  mockupStepContent: {
    flex: 1,
  },
  mockupStepLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: 2,
  },
  mockupStepText: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
  },
  mockupStepLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: spacing.xs,
  },
  mockupHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.sm,
  },
  mockupHintText: {
    ...typography.caption,
    color: colors.warningDark,
  },

  // Practice step mockup
  mockupSeedLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mockupSeedRow: {
    backgroundColor: colors.primaryBg,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  mockupSeedProblem: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 16,
  },
  mockupArrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  mockupArrowLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  mockupArrowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
  },
  mockupArrowText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 11,
  },
  mockupGeneratedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  mockupGeneratedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mockupGeneratedProblem: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
    flex: 1,
  },
});
