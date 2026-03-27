import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface OnboardingScreenProps {
  onComplete: () => void;
}

/** Fade-in + slide-up animation hook */
function useFadeInUp(delay = 0, duration = 500) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  return { opacity, transform: [{ translateY }] };
}

/** Gentle continuous pulse */
function usePulse() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return { transform: [{ scale }] };
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
          <View
            key={i}
            style={[styles.dot, i === slideIndex && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.content}>
        {slideIndex === 0 && <HeroSlide />}
        {slideIndex === 1 && <FlowSlide />}
      </View>

      {/* Navigation */}
      <View style={styles.nav}>
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
      </View>
    </SafeAreaView>
  );
}

/* ── Slide 1: Hero ───────────────────────────────────────── */

function HeroSlide() {
  const logoAnim = useFadeInUp(0, 600);
  const pulseAnim = usePulse();
  const taglineAnim = useFadeInUp(200, 500);
  const subtitleAnim = useFadeInUp(400, 500);
  const pillsAnim = useFadeInUp(600, 500);
  const pill1Anim = useFadeInUp(700, 400);
  const pill2Anim = useFadeInUp(800, 400);
  const pill3Anim = useFadeInUp(900, 400);

  return (
    <View style={styles.slideCenter}>
      {/* Animated logo */}
      <Animated.View style={[logoAnim, pulseAnim]}>
        <LinearGradient colors={gradients.primary} style={styles.heroLogo}>
          <Text style={styles.heroLogoText}>V</Text>
        </LinearGradient>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[styles.heroTagline, taglineAnim]}>
        Snap. Learn. Master.
      </Animated.Text>

      <Animated.Text style={[styles.heroSubtitle, subtitleAnim]}>
        Your AI tutor that breaks any problem{"\n"}into steps you actually understand
      </Animated.Text>

      {/* Feature pills */}
      <Animated.View style={[styles.pillRow, pillsAnim]}>
        <Animated.View style={[styles.pill, shadows.sm, pill1Anim]}>
          <Ionicons name="camera" size={16} color={colors.primary} />
          <Text style={styles.pillText}>Snap a photo</Text>
        </Animated.View>
        <Animated.View style={[styles.pill, shadows.sm, pill2Anim]}>
          <Ionicons name="book" size={16} color={colors.primary} />
          <Text style={styles.pillText}>Learn steps</Text>
        </Animated.View>
        <Animated.View style={[styles.pill, shadows.sm, pill3Anim]}>
          <Ionicons name="infinite" size={16} color={colors.primary} />
          <Text style={styles.pillText}>Practice</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ── Slide 2: The Flow ──────────────────────────────────── */

function FlowSlide() {
  const titleAnim = useFadeInUp(0, 400);
  const subtitleAnim = useFadeInUp(100, 400);
  const step1Anim = useFadeInUp(200, 400);
  const conn1Anim = useFadeInUp(350, 300);
  const step2Anim = useFadeInUp(400, 400);
  const conn2Anim = useFadeInUp(550, 300);
  const step3Anim = useFadeInUp(600, 400);

  return (
    <View style={styles.slideCenter}>
      <Animated.Text style={[styles.flowTitle, titleAnim]}>
        How it works
      </Animated.Text>

      <Animated.Text style={[styles.flowSubtitle, subtitleAnim]}>
        From problem to mastery in minutes
      </Animated.Text>

      <View style={styles.flowSteps}>
        <Animated.View style={[styles.flowCard, shadows.sm, step1Anim]}>
          <LinearGradient colors={gradients.primary} style={styles.flowIconWrap}>
            <Ionicons name="camera" size={20} color={colors.white} />
          </LinearGradient>
          <View style={styles.flowTextWrap}>
            <Text style={styles.flowStepTitle}>Capture</Text>
            <Text style={styles.flowStepDesc}>Snap a photo or type your problem</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.flowConnector, conn1Anim]}>
          <View style={styles.flowConnectorLine} />
          <Ionicons name="chevron-down" size={14} color={colors.primaryLight} />
        </Animated.View>

        <Animated.View style={[styles.flowCard, shadows.sm, step2Anim]}>
          <LinearGradient colors={gradients.primary} style={styles.flowIconWrap}>
            <Ionicons name="book" size={20} color={colors.white} />
          </LinearGradient>
          <View style={styles.flowTextWrap}>
            <Text style={styles.flowStepTitle}>Learn</Text>
            <Text style={styles.flowStepDesc}>AI breaks it into guided steps</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.flowConnector, conn2Anim]}>
          <View style={styles.flowConnectorLine} />
          <Ionicons name="chevron-down" size={14} color={colors.primaryLight} />
        </Animated.View>

        <Animated.View style={[styles.flowCard, shadows.sm, step3Anim]}>
          <LinearGradient colors={gradients.success} style={styles.flowIconWrap}>
            <Ionicons name="infinite" size={20} color={colors.white} />
          </LinearGradient>
          <View style={styles.flowTextWrap}>
            <Text style={styles.flowStepTitle}>Master</Text>
            <Text style={styles.flowStepDesc}>Practice similar problems until it clicks</Text>
          </View>
        </Animated.View>
      </View>
    </View>
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
