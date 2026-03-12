import { useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { ExtractionModal } from "./ExtractionModal";
import { MathKeyboard } from "./MathKeyboard";
import { type Mode } from "./ModeSelectScreen";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useSessionStore } from "../stores/session";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

const MAX_PROBLEMS = 10;

interface Props {
  mode: Mode;
  practiceCount: number;
  problemQueue: string[];
  onProblemQueueChange: (queue: string[]) => void;
  onPracticeCountChange: (count: number) => void;
  onBack: () => void;
  onSessionStart: () => void;
  onSessionError: () => void;
}

export function InputScreen({
  mode,
  practiceCount,
  problemQueue,
  onProblemQueueChange,
  onPracticeCountChange,
  onBack,
  onSessionStart,
  onSessionError,
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const {
    extracting,
    problems: extractedProblems,
    confidence,
    selected,
    selectedCount,
    canAddMore,
    editingIndex,
    editingText,
    lastSource,
    pickImage,
    dismiss: dismissExtraction,
    retry: retryExtraction,
    toggleSelected,
    startEdit,
    setEditingText,
    finishEdit,
    getSelectedProblems,
  } = useImageExtraction(problemQueue.length, MAX_PROBLEMS, setError);

  const handleConfirmExtraction = () => {
    const selectedProblems = getSelectedProblems();
    const remaining = MAX_PROBLEMS - problemQueue.length;
    const toAdd = selectedProblems.slice(0, remaining);
    if (toAdd.length > 0) {
      onProblemQueueChange([...problemQueue, ...toAdd]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    dismissExtraction();
  };

  const {
    startSession,
    startPracticeBatch,
    startPracticeQueue,
    startLearnQueue,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  const handleInsert = (value: string) => {
    setInput(input + value);
    inputRef.current?.focus();
  };

  const handleAddToQueue = () => {
    const text = input.trim();
    if (!text || problemQueue.length >= MAX_PROBLEMS) return;
    onProblemQueueChange([...problemQueue, text]);
    setInput("");
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  };

  const handleRemoveFromQueue = (index: number) => {
    onProblemQueueChange(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditFromQueue = (index: number) => {
    setInput(problemQueue[index]);
    onProblemQueueChange(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  };

  const handleGo = async () => {
    const allProblems = [...problemQueue];
    const text = input.trim();
    if (text) allProblems.push(text);
    if (allProblems.length === 0) return;
    setError(null);

    // Navigate immediately — session screen shows skeleton while loading
    onSessionStart();

    if (allProblems.length === 1) {
      if (mode === "practice") {
        await startPracticeBatch(allProblems[0], practiceCount);
      } else {
        await startSession(allProblems[0], mode);
      }
    } else {
      if (mode === "practice") {
        await startPracticeQueue(allProblems);
      } else {
        await startLearnQueue(allProblems);
      }
    }

    // If generation failed, go back to input — queue is preserved in App state
    const { phase } = useSessionStore.getState();
    if (phase === "error") {
      onSessionError();
    } else {
      onProblemQueueChange([]);
      setInput("");
    }
  };

  const modeLabel = mode === "learn" ? "Learn" : mode === "practice" ? "Practice" : "Mock Exam";
  const modeIcon = mode === "learn" ? "book-outline" : mode === "practice" ? "pencil-outline" : "document-text-outline";
  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const hasNoProblems = totalProblems === 0;
  const goButtonLabel = problemQueue.length > 0
    ? `Start ${modeLabel} (${totalProblems})`
    : "Go";

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <AnimatedPressable
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </AnimatedPressable>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>Enter a Problem</Text>
          <View style={styles.modeChip}>
            <Ionicons name={modeIcon as any} size={16} color={colors.primary} style={{ marginRight: spacing.xs }} />
            <Text style={styles.modeChipText}>{modeLabel}</Text>
          </View>
        </View>

        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Math problem</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.inputField}
              value={input}
              onChangeText={(text) => {
                setInput(text);
                setError(null);
              }}
              placeholder="e.g. 2x + 6 = 12"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType={problemQueue.length > 0 ? "next" : "go"}
              onSubmitEditing={problemQueue.length > 0 ? handleAddToQueue : handleGo}
              inputAccessoryViewID="math-input"
            />
            <AnimatedPressable
              style={[styles.addButton, (!input.trim() || problemQueue.length >= MAX_PROBLEMS) && styles.addButtonDisabled]}
              onPress={handleAddToQueue}
              disabled={!input.trim() || problemQueue.length >= MAX_PROBLEMS}
              scaleDown={0.85}
            >
              <Ionicons
                name="add-circle"
                size={32}
                color={input.trim() && problemQueue.length < MAX_PROBLEMS ? colors.primary : colors.textMuted}
              />
            </AnimatedPressable>
          </View>
        </View>

        <View style={styles.scanRow}>
          <TouchableOpacity
            style={[styles.scanButton, extracting && styles.scanButtonDisabled]}
            onPress={() => pickImage("camera")}
            disabled={extracting || problemQueue.length >= MAX_PROBLEMS}
            activeOpacity={0.6}
          >
            <Ionicons name="camera-outline" size={20} color={extracting ? colors.textMuted : colors.primary} />
            <Text style={[styles.scanButtonText, extracting && styles.scanButtonTextDisabled]}>Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scanButton, extracting && styles.scanButtonDisabled]}
            onPress={() => pickImage("gallery")}
            disabled={extracting || problemQueue.length >= MAX_PROBLEMS}
            activeOpacity={0.6}
          >
            <Ionicons name="image-outline" size={20} color={extracting ? colors.textMuted : colors.primary} />
            <Text style={[styles.scanButtonText, extracting && styles.scanButtonTextDisabled]}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {extracting && (
          <View style={[styles.extractingCard, shadows.sm]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.extractingTitle}>Reading your problems...</Text>
            <Text style={styles.extractingSubtitle}>This usually takes a few seconds</Text>
          </View>
        )}

        {problemQueue.length > 0 && (
          <View style={[styles.queueContainer, shadows.sm]}>
            {problemQueue.map((problem, i) => (
              <TouchableOpacity
                key={`${i}-${problem}`}
                style={styles.queueRow}
                onPress={() => handleEditFromQueue(i)}
                activeOpacity={0.6}
              >
                <Text style={styles.queueIndex}>{i + 1}.</Text>
                <Text style={styles.queueText} numberOfLines={1}>{problem}</Text>
                <TouchableOpacity
                  onPress={() => handleRemoveFromQueue(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.queueRemove}
                >
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
            {problemQueue.length >= MAX_PROBLEMS && (
              <Text style={styles.queueMaxHint}>Maximum {MAX_PROBLEMS} problems</Text>
            )}
          </View>
        )}

        <MathKeyboard onInsert={handleInsert} accessoryID="math-input" />

        {mode === "practice" && problemQueue.length === 0 && (
          <View style={[styles.countPicker, shadows.sm]}>
            <Text style={styles.countLabel}>Similar problems to generate:</Text>
            <View style={styles.stepper}>
              <AnimatedPressable
                scaleDown={0.9}
                onPress={() => onPracticeCountChange(Math.max(0, practiceCount - 1))}
              >
                <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                  <Ionicons name="remove" size={20} color={colors.white} />
                </LinearGradient>
              </AnimatedPressable>
              <Text style={styles.countValue}>{practiceCount}</Text>
              <AnimatedPressable
                scaleDown={0.9}
                onPress={() => onPracticeCountChange(Math.min(20, practiceCount + 1))}
              >
                <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                  <Ionicons name="add" size={20} color={colors.white} />
                </LinearGradient>
              </AnimatedPressable>
            </View>
            <Text style={styles.countHint}>
              Total: {1 + practiceCount} problem{practiceCount > 0 ? "s" : ""}
            </Text>
          </View>
        )}

        <AnimatedPressable
          style={[hasNoProblems && styles.buttonDisabled]}
          onPress={handleGo}
          disabled={isLoading || hasNoProblems}
        >
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.goButton}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.goText}>{goButtonLabel}</Text>
            )}
          </LinearGradient>
        </AnimatedPressable>

        {displayError && (
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.error}>{displayError}</Text>
            {lastSource && (
              <TouchableOpacity onPress={() => { setError(null); pickImage(lastSource); }}>
                <Text style={styles.retryLink}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <ExtractionModal
        problems={extractedProblems}
        confidence={confidence}
        selected={selected}
        selectedCount={selectedCount}
        canAddMore={canAddMore}
        editingIndex={editingIndex}
        editingText={editingText}
        maxProblems={MAX_PROBLEMS}
        onToggle={toggleSelected}
        onStartEdit={startEdit}
        onEditText={setEditingText}
        onFinishEdit={finishEdit}
        onConfirm={handleConfirmExtraction}
        onDismiss={dismissExtraction}
        onRetry={retryExtraction}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.xxl + 4,
    paddingBottom: spacing.xl,
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
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  headerTitle: {
    ...typography.title,
    color: colors.text,
    marginBottom: 10,
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modeChipText: { ...typography.label, color: colors.primary },
  inputWrapper: {
    width: "100%",
    marginBottom: spacing.xs,
  },
  inputLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: "100%",
  },
  inputField: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 17,
    backgroundColor: colors.inputBg,
    color: colors.text,
  },
  addButton: {
    padding: spacing.xs,
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    width: "100%",
  },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  scanButtonText: {
    ...typography.label,
    color: colors.primary,
  },
  scanButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.background,
    opacity: 0.5,
  },
  scanButtonTextDisabled: {
    color: colors.textMuted,
  },
  extractingCard: {
    width: "100%",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.lg,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  extractingTitle: {
    ...typography.bodyBold,
    color: colors.text,
    marginTop: spacing.sm,
  },
  extractingSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  queueContainer: {
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  queueIndex: {
    ...typography.label,
    color: colors.textMuted,
  },
  queueText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  queueRemove: {
    padding: spacing.xs,
  },
  queueMaxHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  goButton: {
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    width: "100%",
    alignItems: "center",
  },
  goText: { color: colors.white, ...typography.button, fontSize: 17 },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  error: { color: colors.error, fontSize: 14, flex: 1 },
  retryLink: {
    ...typography.label,
    color: colors.primary,
    marginLeft: spacing.sm,
  },
  countPicker: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  countLabel: { ...typography.label, color: colors.textSecondary, marginBottom: 10 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  countValue: { fontSize: 26, fontWeight: "bold", color: colors.text, minWidth: 30, textAlign: "center" },
  countHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.4 },
});
