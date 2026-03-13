import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows } from "../theme";

export type Mode = "learn" | "practice" | "mock_test";

interface ModeSelectScreenProps {
  onSelect: (mode: Mode) => void;
  onBack: () => void;
}

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const MODES: { id: Mode; label: string; icon: IoniconsName; iconColor: string; iconBg: string; description: string }[] = [
  {
    id: "learn",
    label: "Learn",
    icon: "book-outline",
    iconColor: colors.primary,
    iconBg: colors.primaryBg,
    description: "Step-by-step guided learning",
  },
  {
    id: "practice",
    label: "Practice",
    icon: "pencil-outline",
    iconColor: colors.success,
    iconBg: colors.successLight,
    description: "Solve problems on your own",
  },
  {
    id: "mock_test",
    label: "Mock Test",
    icon: "document-text-outline",
    iconColor: colors.warningDark,
    iconBg: colors.warningBg,
    description: "Timed exam simulation",
  },
];

export function ModeSelectScreen({ onSelect, onBack }: ModeSelectScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable style={styles.backButton} onPress={onBack}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      <View style={styles.header}>
        <Text style={styles.title}>Choose a Mode</Text>
        <Text style={styles.subtitle}>How would you like to study?</Text>
      </View>

      <View style={styles.list}>
        {MODES.map((mode) => (
          <AnimatedPressable
            key={mode.id}
            style={[styles.card, shadows.sm]}
            onPress={() => onSelect(mode.id)}
          >
            <View style={[styles.iconWrap, { backgroundColor: mode.iconBg }]}>
              <Ionicons name={mode.icon} size={24} color={mode.iconColor} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.label}>{mode.label}</Text>
              <Text style={styles.description}>{mode.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </AnimatedPressable>
        ))}
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
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },
  header: {
    marginBottom: spacing.xxl + 4,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
  },
  list: { gap: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.lg,
  },
  cardText: { flex: 1 },
  label: { ...typography.bodyBold, fontSize: 17, color: colors.text, marginBottom: spacing.xs },
  description: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
});
