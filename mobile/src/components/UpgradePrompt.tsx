import { Modal, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface UpgradePromptProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  title: string;
  message: string;
}

export function UpgradePrompt({ visible, onClose, onUpgrade, title, message }: UpgradePromptProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, shadows.lg]}>
          {/* Icon */}
          <View style={styles.iconCircle}>
            <Ionicons name="layers-outline" size={28} color={colors.primary} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>

          {/* Buttons */}
          <View style={styles.buttons}>
            <AnimatedPressable style={styles.laterButton} onPress={onClose} scaleDown={0.96}>
              <Text style={styles.laterText}>Maybe Later</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.upgradeButton} onPress={onUpgrade} scaleDown={0.96}>
              <Text style={styles.upgradeText}>Upgrade to Pro</Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  buttons: {
    flexDirection: "row",
    gap: spacing.sm,
    alignSelf: "stretch",
  },
  laterButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  laterText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 14,
  },
  upgradeButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  upgradeText: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 14,
  },
});
