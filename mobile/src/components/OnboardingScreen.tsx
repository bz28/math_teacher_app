import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [slideIndex, setSlideIndex] = useState(0);

  const handleNext = () => {
    if (slideIndex === 1) {
      onComplete();
    } else {
      setSlideIndex(1);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.progressRow}>
        {[0, 1].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              i === slideIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      <View style={styles.content}>
        {slideIndex === 0 && <HeroSlide />}
        {slideIndex === 1 && <FlowSlide />}
      </View>

      {/* Navigation */}
      <Animated.View
        entering={FadeInUp.delay(600).duration(400)}
        style={styles.nav}
      >
        {slideIndex > 0 ? (
          <AnimatedPressable onPress={() => setSlideIndex(0)} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable onPress={onComplete} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </AnimatedPressable>
        )}

        <AnimatedPressable onPress={handleNext} scaleDown={0.95}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.nextButton}
          >
            <Text style={styles.nextText}>
              {slideIndex === 1 ? "Get Started" : "Continue"}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </LinearGradient>
        </AnimatedPressable>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ── Slide 1: Hero ───────────────────────────────────────── */

function HeroSlide() {
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 2000 }),
        withTiming(1, { duration: 2000 }),
      ),
      -1,
      true,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  return (
    <View style={styles.slideCenter}>
      {/* Animated logo */}
      <Animated.View
        entering={FadeInDown.duration(600).springify()}
        style={pulseStyle}
      >
        <LinearGradient
          colors={gradients.primary}
          style={styles.heroLogo}
        >
          <Text style={styles.heroLogoText}>V</Text>
        </LinearGradient>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text
        entering={FadeInDown.delay(200).duration(500)}
        style={styles.heroTagline}
      >
        Snap. Learn. Master.
      </Animated.Text>

      <Animated.Text
        entering={FadeInDown.delay(400).duration(500)}
        style={styles.heroSubtitle}
      >
        Your AI tutor that breaks any problem{"\n"}into steps you actually understand
      </Animated.Text>

      {/* Feature pills */}
      <Animated.View
        entering={FadeInUp.delay(600).duration(500)}
        style={styles.pillRow}
      >
        <FeaturePill icon="camera" label="Snap a photo" delay={0} />
        <FeaturePill icon="book" label="Learn steps" delay={100} />
        <FeaturePill icon="infinite" label="Practice" delay={200} />
      </Animated.View>
    </View>
  );
}

function FeaturePill({ icon, label, delay }: { icon: string; label: string; delay: number }) {
  return (
    <Animated.View
      entering={FadeInUp.delay(700 + delay).duration(400)}
      style={[styles.pill, shadows.sm]}
    >
      <Ionicons name={icon as any} size={16} color={colors.primary} />
      <Text style={styles.pillText}>{label}</Text>
    </Animated.View>
  );
}

/* ── Slide 2: The Flow ──────────────────────────────────── */

function FlowSlide() {
  return (
    <View style={styles.slideCenter}>
      <Animated.Text
        entering={FadeInDown.duration(400)}
        style={styles.flowTitle}
      >
        How it works
      </Animated.Text>

      <Animated.Text
        entering={FadeInDown.delay(100).duration(400)}
        style={styles.flowSubtitle}
      >
        From problem to mastery in minutes
      </Animated.Text>

      <View style={styles.flowSteps}>
        <FlowStep
          index={1}
          icon="camera"
          title="Capture"
          description="Snap a photo or type your problem"
          gradient={gradients.primary}
          delay={200}
        />
        <FlowConnector delay={400} />
        <FlowStep
          index={2}
          icon="book"
          title="Learn"
          description="AI breaks it into guided steps"
          gradient={gradients.primary}
          delay={400}
        />
        <FlowConnector delay={600} />
        <FlowStep
          index={3}
          icon="infinite"
          title="Master"
          description="Practice similar problems until it clicks"
          gradient={gradients.success}
          delay={600}
        />
      </View>
    </View>
  );
}

function FlowStep({
  index,
  icon,
  title,
  description,
  gradient,
  delay,
}: {
  index: number;
  icon: string;
  title: string;
  description: string;
  gradient: readonly [string, string];
  delay: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400).springify()}
      style={[styles.flowCard, shadows.sm]}
    >
      <LinearGradient colors={gradient} style={styles.flowIconWrap}>
        <Ionicons name={icon as any} size={20} color={colors.white} />
      </LinearGradient>
      <View style={styles.flowTextWrap}>
        <Text style={styles.flowStepTitle}>{title}</Text>
        <Text style={styles.flowStepDesc}>{description}</Text>
      </View>
    </Animated.View>
  );
}

function FlowConnector({ delay }: { delay: number }) {
  return (
    <Animated.View
      entering={FadeIn.delay(delay + 100).duration(300)}
      style={styles.flowConnector}
    >
      <View style={styles.flowConnectorLine} />
      <Ionicons name="chevron-down" size={14} color={colors.primaryLight} />
    </Animated.View>
  );
}

/* ── Styles ─────────────────────────────────────────────── */

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
  skipButton: {
    padding: spacing.sm,
  },
  skipText: {
    color: colors.textMuted,
    ...typography.bodyBold,
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 14,
  },
  nextText: { color: colors.white, ...typography.button },

  // Shared slide
  slideCenter: {
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },

  // Hero slide
  heroLogo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  heroLogoText: {
    fontSize: 44,
    fontWeight: "800",
    color: colors.white,
    letterSpacing: -1,
  },
  heroTagline: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.xxxl,
  },
  pillRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  pillText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
  },

  // Flow slide
  flowTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  flowSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xxl,
  },
  flowSteps: {
    width: "100%",
    alignItems: "center",
  },
  flowCard: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.lg,
    gap: spacing.md,
  },
  flowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  flowTextWrap: {
    flex: 1,
  },
  flowStepTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 16,
    marginBottom: 2,
  },
  flowStepDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  flowConnector: {
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  flowConnectorLine: {
    width: 2,
    height: 8,
    backgroundColor: colors.primaryLight,
    marginBottom: 2,
  },
});
