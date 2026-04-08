import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { getSubjectMeta } from "./SubjectPills";
import { colors, spacing, radii, typography, gradients } from "../theme";

interface Props {
  subject: string;
  mode: "learn" | "test";
}

const PHRASES_LEARN = [
  "Reading the problem…",
  "Working through it…",
  "Building your steps…",
  "Almost ready…",
];
const PHRASES_TEST = [
  "Setting up your exam…",
  "Generating questions…",
  "Picking the best problems…",
  "Almost ready…",
];

/**
 * Subject-themed full-screen loading state with a pulsing icon and a
 * rotating subtitle phrase, so the user has something to look at instead
 * of a static spinner while session generation is in flight.
 */
export function LoadingHero({ subject, mode }: Props) {
  const meta = getSubjectMeta(subject);
  const phrases = mode === "test" ? PHRASES_TEST : PHRASES_LEARN;
  const icon = mode === "test" ? "document-text" : "book";
  const [phraseIdx, setPhraseIdx] = useState(0);
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  // Pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    ).start();
  }, [scale, opacity]);

  // Rotate subtitle phrases slowly, stopping at the last phrase ("Almost ready…")
  useEffect(() => {
    const t = setInterval(() => {
      setPhraseIdx((i) => {
        if (i >= phrases.length - 1) return i; // hold at last phrase
        return i + 1;
      });
    }, 2400);
    return () => clearInterval(t);
  }, [phrases.length]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradients[meta.gradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.iconWrap, { transform: [{ scale }], opacity }]}>
        <Ionicons name={icon} size={64} color={colors.white} />
      </Animated.View>
      <Text style={styles.title}>
        {mode === "test" ? "Setting up your exam" : "Building your session"}
      </Text>
      <Text style={styles.subtitle}>{phrases[phraseIdx]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.title,
    color: colors.white,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
  },
});
