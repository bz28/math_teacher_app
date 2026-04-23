import { useEffect, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useFadeInUp } from "../hooks/useFadeInUp";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface OnboardingScreenProps {
  onComplete: () => void;
}

const TOTAL_SLIDES = 4;

/** Gentle continuous pulse used by the hero logo */
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
  const isLast = slideIndex === TOTAL_SLIDES - 1;

  const handleNext = () => {
    if (isLast) onComplete();
    else setSlideIndex(slideIndex + 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.progressRow}>
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <View key={i} style={[styles.dot, i === slideIndex && styles.dotActive]} />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {slideIndex === 0 && <WelcomeSlide />}
        {slideIndex === 1 && <SnapSlide />}
        {slideIndex === 2 && <LearnSlide />}
        {slideIndex === 3 && <PracticeSlide />}
      </ScrollView>

      {/* Navigation */}
      <View style={styles.nav}>
        {slideIndex > 0 ? (
          <AnimatedPressable onPress={() => setSlideIndex(slideIndex - 1)} style={styles.backButton}>
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
            <Text style={styles.nextText}>{isLast ? "Get Started" : "Continue"}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.white} />
          </LinearGradient>
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

/* ── Slide 1: Welcome ──────────────────────────────────── */

function WelcomeSlide() {
  const logoAnim = useFadeInUp(0, 600);
  const pulseAnim = usePulse();
  const taglineAnim = useFadeInUp(200, 500);
  const subtitleAnim = useFadeInUp(400, 500);
  const pillsAnim = useFadeInUp(600, 500);

  return (
    <View style={styles.slideCenter}>
      <Animated.View style={[logoAnim, pulseAnim]}>
        <LinearGradient colors={gradients.primary} style={styles.heroLogo}>
          <Text style={styles.heroLogoText}>V</Text>
        </LinearGradient>
      </Animated.View>

      <Animated.Text style={[styles.heroTagline, taglineAnim]}>
        Welcome to Veradic
      </Animated.Text>

      <Animated.Text style={[styles.heroSubtitle, subtitleAnim]}>
        Your AI tutor for math, science,{"\n"}and chemistry — learn every step.
      </Animated.Text>

      <Animated.View style={[styles.pillRow, pillsAnim]}>
        <View style={[styles.pill, shadows.sm]}>
          <Ionicons name="camera" size={14} color={colors.primary} />
          <Text style={styles.pillText}>Snap</Text>
        </View>
        <View style={[styles.pill, shadows.sm]}>
          <Ionicons name="book" size={14} color={colors.primary} />
          <Text style={styles.pillText}>Learn</Text>
        </View>
        <View style={[styles.pill, shadows.sm]}>
          <Ionicons name="infinite" size={14} color={colors.primary} />
          <Text style={styles.pillText}>Practice</Text>
        </View>
      </Animated.View>
    </View>
  );
}

/* ── Slide 2: Snap any problem ─────────────────────────── */

function SnapSlide() {
  const titleAnim = useFadeInUp(0, 400);
  const subtitleAnim = useFadeInUp(100, 400);
  const previewAnim = useFadeInUp(200, 500);

  return (
    <View style={styles.slideCenter}>
      <Animated.Text style={[styles.slideTitle, titleAnim]}>
        Snap any problem
      </Animated.Text>
      <Animated.Text style={[styles.slideSubtitle, subtitleAnim]}>
        Point your camera at a textbook,{"\n"}worksheet, or your handwritten work.
      </Animated.Text>

      {/* Mock viewfinder with a math problem inside */}
      <Animated.View style={[styles.previewFrame, shadows.lg, previewAnim]}>
        <View style={[styles.frameCorner, styles.cornerTL]} />
        <View style={[styles.frameCorner, styles.cornerTR]} />
        <View style={[styles.frameCorner, styles.cornerBL]} />
        <View style={[styles.frameCorner, styles.cornerBR]} />

        <View style={styles.previewContent}>
          <Text style={styles.mockProblemLabel}>PROBLEM 7</Text>
          <Text style={styles.mockProblem}>Solve for x:{"\n"}3x + 5 = 20</Text>
        </View>

        <View style={styles.shutterDot}>
          <Ionicons name="camera" size={20} color={colors.white} />
        </View>
      </Animated.View>
    </View>
  );
}

/* ── Slide 3: Step-by-step learning ────────────────────── */

function LearnSlide() {
  const titleAnim = useFadeInUp(0, 400);
  const subtitleAnim = useFadeInUp(100, 400);
  const step1Anim = useFadeInUp(200, 400);
  const step2Anim = useFadeInUp(350, 400);
  const step3Anim = useFadeInUp(500, 400);
  const askAnim = useFadeInUp(700, 400);

  return (
    <View style={styles.slideCenter}>
      <Animated.Text style={[styles.slideTitle, titleAnim]}>
        Learn step by step
      </Animated.Text>
      <Animated.Text style={[styles.slideSubtitle, subtitleAnim]}>
        Veradic breaks every problem into{"\n"}clear, guided steps.
      </Animated.Text>

      <View style={styles.stepStack}>
        <Animated.View style={[styles.stepRow, step1Anim]}>
          <View style={styles.stepBadgeDone}>
            <Ionicons name="checkmark" size={14} color={colors.white} />
          </View>
          <View style={styles.stepRowText}>
            <Text style={styles.stepRowTitle}>Subtract 5 from both sides</Text>
            <Text style={styles.stepRowSub}>3x = 15</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.stepRow, step2Anim]}>
          <View style={styles.stepBadgeActive}>
            <Text style={styles.stepBadgeNumber}>2</Text>
          </View>
          <View style={styles.stepRowText}>
            <Text style={styles.stepRowTitle}>Divide both sides by 3</Text>
            <Text style={styles.stepRowSub}>x = ?</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.stepRow, step3Anim]}>
          <View style={styles.stepBadgeIdle}>
            <Text style={styles.stepBadgeNumberIdle}>3</Text>
          </View>
          <View style={styles.stepRowText}>
            <Text style={styles.stepRowTitleIdle}>Check your answer</Text>
          </View>
        </Animated.View>
      </View>

      {/* Ask hint bubble */}
      <Animated.View style={[styles.askHint, shadows.sm, askAnim]}>
        <Ionicons name="chatbubble-ellipses" size={14} color={colors.primary} />
        <Text style={styles.askHintText}>
          Stuck on a step? Tap <Text style={styles.askHintBold}>Ask</Text> to chat with Veradic.
        </Text>
      </Animated.View>
    </View>
  );
}

/* ── Slide 4: Practice & test ──────────────────────────── */

function PracticeSlide() {
  const titleAnim = useFadeInUp(0, 400);
  const subtitleAnim = useFadeInUp(100, 400);
  const card1Anim = useFadeInUp(200, 400);
  const card2Anim = useFadeInUp(350, 400);
  const card3Anim = useFadeInUp(500, 400);

  return (
    <View style={styles.slideCenter}>
      <Animated.Text style={[styles.slideTitle, titleAnim]}>
        Practice and test yourself
      </Animated.Text>
      <Animated.Text style={[styles.slideSubtitle, subtitleAnim]}>
        Generate unlimited similar problems{"\n"}or take a timed mock exam.
      </Animated.Text>

      <View style={styles.modeCardStack}>
        <Animated.View style={[card1Anim, { width: "100%" }]}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.modeCard, shadows.md]}
          >
            <Ionicons name="book" size={22} color={colors.white} />
            <View style={styles.modeCardText}>
              <Text style={styles.modeCardTitle}>Learn Mode</Text>
              <Text style={styles.modeCardSub}>Step-by-step guided learning</Text>
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[card2Anim, { width: "100%" }]}>
          <LinearGradient
            colors={gradients.warning}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.modeCard, shadows.md]}
          >
            <Ionicons name="document-text" size={22} color={colors.white} />
            <View style={styles.modeCardText}>
              <Text style={styles.modeCardTitle}>Mock Test</Text>
              <Text style={styles.modeCardSub}>Practice or generate an exam</Text>
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[card3Anim, { width: "100%" }]}>
          <LinearGradient
            colors={gradients.success}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.modeCard, shadows.md]}
          >
            <Ionicons name="infinite" size={22} color={colors.white} />
            <View style={styles.modeCardText}>
              <Text style={styles.modeCardTitle}>Unlimited Practice</Text>
              <Text style={styles.modeCardSub}>More problems like the one you scanned</Text>
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl,
  },

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

  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },

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
  skipButton: { padding: spacing.sm },
  skipText: { color: colors.textMuted, ...typography.bodyBold },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 14,
  },
  nextText: { color: colors.white, ...typography.button },

  slideCenter: {
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },

  // Shared slide title/subtitle
  slideTitle: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  slideSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.xxl,
  },

  // Welcome slide
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
    fontSize: 30,
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

  // Snap slide — viewfinder mock
  previewFrame: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  frameCorner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: colors.primary,
  },
  cornerTL: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  previewContent: {
    alignItems: "center",
    gap: spacing.sm,
  },
  mockProblemLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
    fontSize: 10,
  },
  mockProblem: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    lineHeight: 30,
  },
  shutterDot: {
    position: "absolute",
    bottom: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: colors.background,
  },

  // Learn slide — step list mock
  stepStack: {
    width: "100%",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
  },
  stepBadgeDone: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.success,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeActive: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeIdle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeNumber: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  stepBadgeNumberIdle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  stepRowText: { flex: 1 },
  stepRowTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  stepRowTitleIdle: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  stepRowSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  askHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  askHintText: {
    ...typography.body,
    color: colors.primary,
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  askHintBold: {
    fontWeight: "700",
  },

  // Practice slide — mode cards
  modeCardStack: {
    width: "100%",
    gap: spacing.sm + 2,
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  modeCardText: { flex: 1 },
  modeCardTitle: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 15,
  },
  modeCardSub: {
    ...typography.caption,
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 2,
  },
});
