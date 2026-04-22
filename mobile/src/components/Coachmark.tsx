import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { useColors, spacing, radii, typography, shadows, type ColorPalette } from "../theme";

interface Props {
  visible: boolean;
  text: string;
  onDismiss: () => void;
  /** Visual hint about which direction the tip is pointing. Affects arrow placement. */
  arrow?: "up" | "down" | "none";
}

// A small one-time hint banner. Not a floating tooltip — positioned inline by
// the parent. Tap anywhere on the banner to dismiss.
export function Coachmark({ visible, text, onDismiss, arrow = "none" }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Reset refs so a subsequent visible=true replays the fade-in instead
      // of no-op'ing from already-at-target values.
      opacity.setValue(0);
      translateY.setValue(10);
    }
  }, [visible, opacity, translateY]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.wrap, { opacity, transform: [{ translateY }] }]}>
      {arrow === "up" && <View style={[styles.arrow, styles.arrowUp]} />}
      <AnimatedPressable onPress={onDismiss} scaleDown={0.98}>
        <View style={[styles.bubble, shadows.md]}>
          <Ionicons name="sparkles" size={16} color={colors.primary} />
          <Text style={styles.text}>{text}</Text>
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </View>
      </AnimatedPressable>
      {arrow === "down" && <View style={[styles.arrow, styles.arrowDown]} />}
    </Animated.View>
  );
}

const makeStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    wrap: {
      alignSelf: "stretch",
    },
    bubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.primaryBg,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    text: {
      ...typography.body,
      color: colors.primary,
      fontSize: 13,
      flex: 1,
      lineHeight: 18,
    },
    arrow: {
      width: 0,
      height: 0,
      alignSelf: "center",
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderLeftColor: "transparent",
      borderRightColor: "transparent",
    },
    arrowDown: {
      borderTopWidth: 8,
      borderTopColor: colors.primary,
    },
    arrowUp: {
      borderBottomWidth: 8,
      borderBottomColor: colors.primary,
    },
  });
