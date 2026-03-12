import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface Props {
  problems: string[] | null;
  confidence: string;
  selected: boolean[];
  selectedCount: number;
  canAddMore: boolean;
  editingIndex: number | null;
  editingText: string;
  maxProblems: number;
  onToggle: (index: number) => void;
  onStartEdit: (index: number) => void;
  onEditText: (text: string) => void;
  onFinishEdit: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}

export function ExtractionModal({
  problems,
  confidence,
  selected,
  selectedCount,
  canAddMore,
  editingIndex,
  editingText,
  maxProblems,
  onToggle,
  onStartEdit,
  onEditText,
  onFinishEdit,
  onConfirm,
  onDismiss,
  onRetry,
}: Props) {
  return (
    <Modal
      visible={problems !== null}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.content, shadows.lg]}>
          <View style={styles.header}>
            <Text style={styles.title}>
              Found {problems?.length ?? 0} problem{(problems?.length ?? 0) !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {confidence !== "high" && (
            <View style={[
              styles.confidenceBadge,
              confidence === "low" ? styles.confidenceLow : styles.confidenceMedium,
            ]}>
              <Ionicons
                name={confidence === "low" ? "warning" : "alert-circle-outline"}
                size={16}
                color={confidence === "low" ? colors.warningDark : colors.warning}
              />
              <Text style={[styles.confidenceText, confidence === "low" && styles.confidenceTextLow]}>
                {confidence === "low"
                  ? "Image was hard to read — please review carefully"
                  : "Some parts were unclear — double-check the results"}
              </Text>
              <TouchableOpacity onPress={onRetry} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.hint}>Tap to edit · Uncheck to skip</Text>

          <ScrollView style={styles.list} bounces={false}>
            {problems?.map((problem, i) => (
              <View key={`ext-${i}`} style={styles.row}>
                <TouchableOpacity
                  onPress={() => onToggle(i)}
                  style={styles.checkbox}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Ionicons
                    name={selected[i] ? "checkbox" : "square-outline"}
                    size={24}
                    color={selected[i] ? colors.primary : colors.textMuted}
                  />
                </TouchableOpacity>
                {editingIndex === i ? (
                  <TextInput
                    style={styles.editInput}
                    value={editingText}
                    onChangeText={onEditText}
                    onBlur={onFinishEdit}
                    onSubmitEditing={onFinishEdit}
                    autoFocus
                    returnKeyType="done"
                    selectTextOnFocus
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.textWrap}
                    onPress={() => onStartEdit(i)}
                    activeOpacity={0.6}
                  >
                    <Text
                      style={[styles.problemText, !selected[i] && styles.deselected]}
                      numberOfLines={2}
                    >
                      {problem}
                    </Text>
                    <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>

          {!canAddMore && (
            <Text style={styles.warning}>
              Queue is full ({maxProblems} problems max)
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, selectedCount === 0 && styles.disabled]}
              onPress={onConfirm}
              disabled={selectedCount === 0}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.addGradient}
              >
                <Text style={styles.addText}>
                  Add Selected ({selectedCount})
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    maxHeight: "75%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
  },
  confidenceMedium: {
    backgroundColor: colors.warningBg,
  },
  confidenceLow: {
    backgroundColor: colors.errorLight,
  },
  confidenceText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  confidenceTextLow: {
    color: colors.warningDark,
  },
  retryText: {
    ...typography.label,
    color: colors.primary,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  list: {
    flexGrow: 0,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  checkbox: {
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  problemText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  deselected: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  editInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    padding: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.inputBg,
  },
  warning: {
    ...typography.caption,
    color: colors.warningDark,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
  },
  cancelText: {
    ...typography.button,
    color: colors.textSecondary,
  },
  addBtn: {
    flex: 2,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  addGradient: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  addText: {
    ...typography.button,
    color: colors.white,
  },
  disabled: { opacity: 0.4 },
});
