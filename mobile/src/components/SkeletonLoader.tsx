import { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";
import { useColors, spacing, radii, type ColorPalette } from "../theme";

/** Shared pulse animation — all bones shimmer in sync. */
function usePulse() {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return opacity;
}

function Bone({
  width,
  height,
  style,
  opacity,
}: {
  width: number | `${number}%`;
  height: number;
  style?: ViewStyle;
  opacity: Animated.Value;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Animated.View style={[styles.bone, { width, height, opacity }, style]} />
  );
}

/** Shared header + problem card + progress bar. */
function CommonSkeleton({
  opacity,
  badgeWidth,
  problemWidth,
  children,
}: {
  opacity: Animated.Value;
  badgeWidth: number;
  problemWidth: `${number}%`;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Bone width={60} height={14} opacity={opacity} />
        <Bone width={badgeWidth} height={24} opacity={opacity} style={{ borderRadius: radii.pill }} />
      </View>

      <View style={styles.card}>
        <Bone width={60} height={10} opacity={opacity} />
        <Bone width={problemWidth} height={18} opacity={opacity} style={{ marginTop: spacing.sm }} />
      </View>

      <View style={styles.progressRow}>
        <Bone width="85%" height={6} opacity={opacity} style={{ borderRadius: 3 }} />
        <Bone width={45} height={12} opacity={opacity} />
      </View>

      {children}
    </View>
  );
}

/** Skeleton that mimics the learn mode session layout. */
export function SessionSkeleton() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = usePulse();

  return (
    <CommonSkeleton opacity={opacity} badgeWidth={50} problemWidth="80%">
      <View style={styles.stepCard}>
        <Bone width={40} height={10} opacity={opacity} />
        <Bone width="90%" height={14} opacity={opacity} style={{ marginTop: spacing.sm }} />
        <Bone width="60%" height={14} opacity={opacity} style={{ marginTop: spacing.xs }} />
      </View>

      <Bone width="50%" height={14} opacity={opacity} style={{ alignSelf: "center" }} />
      <Bone width="100%" height={48} opacity={opacity} style={{ marginTop: spacing.sm, borderRadius: radii.md }} />
      <Bone width="100%" height={48} opacity={opacity} style={{ marginTop: spacing.md, borderRadius: radii.md }} />
    </CommonSkeleton>
  );
}

/** Skeleton that mimics the practice batch layout. */
export function PracticeSkeleton() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const opacity = usePulse();

  return (
    <CommonSkeleton opacity={opacity} badgeWidth={40} problemWidth="75%">
      <Bone width="55%" height={14} opacity={opacity} style={{ marginTop: spacing.lg }} />
      <Bone width="100%" height={48} opacity={opacity} style={{ marginTop: spacing.sm, borderRadius: radii.md }} />

      <View style={styles.buttonRow}>
        <Bone width="65%" height={48} opacity={opacity} style={{ borderRadius: radii.md }} />
        <Bone width="30%" height={48} opacity={opacity} style={{ borderRadius: radii.md }} />
      </View>
    </CommonSkeleton>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
  },
  bone: {
    backgroundColor: colors.border,
    borderRadius: radii.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.md,
  },
  stepCard: {
    backgroundColor: colors.primaryBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
