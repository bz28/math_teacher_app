import { useEffect, useMemo, useState } from "react";
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
import { MathText } from "./MathText";
import { useColors, spacing, radii, typography, shadows, gradients, type ColorPalette } from "../theme";

interface Props {
  /** When non-null the modal is visible showing these questions. */
  questions: string[] | null;
  loading: boolean;
  /** Number of questions originally requested — shown if fewer came back. */
  requestedCount?: number;
  onStart: (finalQuestions: string[]) => void;
  onCancel: () => void;
  onRetry: () => void;
}

/** Final audit step of Mock Test's "From objectives" flow: student
 *  reviews the generated question text, can deselect or inline-edit,
 *  and then taps Start Exam. Mirrors ExtractionModal's UX so students
 *  don't have to learn a new pattern — but this modal commits straight
 *  to startMockTest instead of adding to the input queue. */
export function GeneratedQuestionsAudit({
  questions,
  loading,
  requestedCount,
  onStart,
  onCancel,
  onRetry,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<string[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Sync local editable list whenever the incoming questions change
  useEffect(() => {
    if (questions) {
      setItems(questions);
      setSelected(questions.map(() => true));
      setEditingIndex(null);
      setEditingText("");
    }
  }, [questions]);

  const selectedCount = selected.filter(Boolean).length;
  const visible = questions !== null || loading;

  const toggle = (i: number) => {
    setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  };

  const startEdit = (i: number) => {
    setEditingIndex(i);
    setEditingText(items[i] ?? "");
  };

  const finishEdit = () => {
    if (editingIndex === null) return;
    const text = editingText.trim();
    if (text) {
      setItems((prev) => prev.map((p, idx) => (idx === editingIndex ? text : p)));
    }
    setEditingIndex(null);
    setEditingText("");
  };

  const handleStart = () => {
    const finalQuestions = items.filter((_, i) => selected[i]);
    if (finalQuestions.length === 0) return;
    onStart(finalQuestions);
  };

  const shortfall =
    !loading && requestedCount !== undefined && items.length > 0 && items.length < requestedCount
      ? requestedCount - items.length
      : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.content, shadows.lg]}>
          {loading ? (
            <View style={styles.loading}>
              <Ionicons name="sparkles-outline" size={28} color={colors.primary} />
              <Text style={styles.loadingTitle}>Crafting your practice exam…</Text>
              <Text style={styles.loadingSub}>
                Writing {requestedCount ?? "your"} questions from the objectives you picked.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Review your exam</Text>
                <TouchableOpacity
                  onPress={onCancel}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Cancel"
                >
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.hint}>
                Tap a question to edit · Uncheck to skip · Start when you're ready
              </Text>

              {shortfall > 0 && (
                <View style={styles.shortfall}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                  <Text style={styles.shortfallText}>
                    Got {items.length} of {requestedCount} — tap retry to regenerate.
                  </Text>
                  <TouchableOpacity onPress={onRetry}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}

              <ScrollView style={styles.list} bounces={false}>
                {items.map((q, i) => (
                  <View key={`q-${i}`} style={styles.row}>
                    <TouchableOpacity
                      onPress={() => toggle(i)}
                      style={styles.checkbox}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected[i] }}
                      accessibilityLabel={`Question ${i + 1}`}
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
                        onChangeText={setEditingText}
                        onBlur={finishEdit}
                        onSubmitEditing={finishEdit}
                        autoFocus
                        multiline
                        returnKeyType="done"
                        selectTextOnFocus
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.textWrap}
                        onPress={() => startEdit(i)}
                        activeOpacity={0.6}
                      >
                        <MathText
                          text={q}
                          style={{
                            ...styles.problemText,
                            ...(!selected[i] ? styles.deselected : {}),
                          }}
                          numberOfLines={3}
                        />
                        <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                  <Text style={styles.cancelText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.startBtn, selectedCount === 0 && styles.disabled]}
                  onPress={handleStart}
                  disabled={selectedCount === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`Start exam with ${selectedCount} questions`}
                >
                  <LinearGradient
                    colors={gradients.warning}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.startGradient}
                  >
                    <Text style={styles.startText}>Start Exam ({selectedCount})</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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
    maxHeight: "85%",
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  loadingTitle: {
    ...typography.heading,
    color: colors.text,
    textAlign: "center",
  },
  loadingSub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
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
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  shortfall: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.warningBg,
  },
  shortfallText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  retryText: {
    ...typography.label,
    color: colors.primary,
  },
  list: {
    flexGrow: 0,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  checkbox: {
    flexShrink: 0,
    paddingTop: 2,
  },
  textWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
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
    minHeight: 60,
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
  startBtn: {
    flex: 2,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  startGradient: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  startText: {
    ...typography.button,
    color: colors.white,
  },
  disabled: { opacity: 0.4 },
});
