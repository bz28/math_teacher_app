import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

export type Mode = "learn" | "practice" | "mock_test";

interface ModeSelectScreenProps {
  onSelect: (mode: Mode) => void;
  onBack: () => void;
}

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface ModeConfig {
  id: Mode;
  label: string;
  icon: IoniconsName;
  gradient: readonly [string, string];
  description: string;
  features: string[];
}

const MODES: ModeConfig[] = [
  {
    id: "learn",
    label: "Learn",
    icon: "book",
    gradient: gradients.primary,
    description: "Step-by-step guided learning",
    features: ["AI breaks problems into steps", "Ask questions anytime", "Practice similar problems after"],
  },
  {
    id: "mock_test",
    label: "Mock Test",
    icon: "document-text",
    gradient: gradients.warning,
    description: "Use your own problems or generate an exam",
    features: ["Timed or untimed exams", "Generate similar questions", "Review and learn flagged problems"],
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
        <Text style={styles.title}>How do you want{"\n"}to study?</Text>
      </View>

      <View style={styles.list}>
        {MODES.map((mode) => (
          <AnimatedPressable
            key={mode.id}
            style={[styles.card, shadows.md]}
            onPress={() => onSelect(mode.id)}
            scaleDown={0.97}
          >
            <LinearGradient
              colors={mode.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardGradientHeader}
            >
              <Ionicons name={mode.icon} size={24} color={colors.white} />
              <Text style={styles.cardLabel}>{mode.label}</Text>
              <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.7)" style={styles.cardArrow} />
            </LinearGradient>
            <View style={styles.cardBody}>
              <Text style={styles.cardDesc}>{mode.description}</Text>
              {mode.features.map((feature, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons name="checkmark" size={14} color={colors.success} />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>
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
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.hero,
    color: colors.text,
  },

  list: {
    gap: spacing.lg,
  },

  // Mode cards
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: "hidden",
  },
  cardGradientHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  cardLabel: {
    ...typography.heading,
    color: colors.white,
    flex: 1,
  },
  cardArrow: {
    marginLeft: "auto",
  },
  cardBody: {
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  cardDesc: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  featureText: {
    ...typography.caption,
    color: colors.text,
    fontSize: 13,
  },
});
