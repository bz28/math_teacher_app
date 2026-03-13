import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
import { BackButton } from "./BackButton";
import { GradientButton } from "./GradientButton";
import { ExtractionModal } from "./ExtractionModal";
import { MathKeyboard } from "./MathKeyboard";
import { type Mode } from "./ModeSelectScreen";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useSessionStore } from "../stores/session";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

const MAX_PROBLEMS = 10;

interface Props {
  mode: Mode;
  onBack: () => void;
  onSessionStart: () => void;
  onSessionError: () => void;
}

export function InputScreen({
  mode,
  onBack,
  onSessionStart,
  onSessionError,
}: Props) {
  const problemQueue = useSessionStore((s) => s.problemQueue);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showMorePrompt, setShowMorePrompt] = useState(false);
  const [similarCount, setSimilarCount] = useState(0);

  // Mock test config state
  const [mockExamType, setMockExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [mockGenerateCount, setMockGenerateCount] = useState(5);
  const [mockTimeLimitMinutes, setMockTimeLimitMinutes] = useState(30);
  const [mockUntimed, setMockUntimed] = useState(false);
  const startMockTest = useSessionStore((s) => s.startMockTest);

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
    const selected = getSelectedProblems();
    const remaining = MAX_PROBLEMS - problemQueue.length;
    const toAdd = selected.slice(0, remaining);
    if (toAdd.length > 0) {
      setProblemQueue([...problemQueue, ...toAdd]);
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
    setProblemQueue([...problemQueue, text]);
    setInput("");
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  };

  const handleRemoveFromQueue = (index: number) => {
    setProblemQueue(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditFromQueue = (index: number) => {
    setInput(problemQueue[index]);
    setProblemQueue(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    inputRef.current?.focus();
  };

  const collectProblems = (): string[] => {
    const allProblems = [...problemQueue];
    const text = input.trim();
    if (text) allProblems.push(text);
    return allProblems;
  };

  const handleGo = async () => {
    const allProblems = collectProblems();
    if (allProblems.length === 0) return;
    setError(null);

    // Mock test mode — start exam directly
    if (mode === "mock_test") {
      onSessionStart();
      const generateCount = mockExamType === "generate_similar" ? mockGenerateCount : 0;
      const timeLimitMinutes = mockUntimed ? null : mockTimeLimitMinutes;
      await startMockTest(allProblems, generateCount, timeLimitMinutes);
      const postPhase = useSessionStore.getState().phase;
      if (postPhase === "error") {
        onSessionError();
      } else {
        setProblemQueue([]);
      }
      return;
    }

    // Single problem in practice mode — ask if they want similar problems
    if (mode === "practice" && allProblems.length === 1) {
      setSimilarCount(0);
      setShowMorePrompt(true);
      return;
    }

    await startProblems(allProblems, 0);
  };

  const startProblems = async (allProblems: string[], count: number) => {
    setError(null);

    // Navigate immediately — session screen shows skeleton while loading
    onSessionStart();

    if (allProblems.length === 1) {
      if (mode === "practice") {
        await startPracticeBatch(allProblems[0], count);
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

    // After the async actions complete, sessionPhase reflects the latest state
    // because the store updates trigger a re-render. But since startProblems
    // is async, we need to read the store directly here (one-time read, not
    // a subscription — acceptable since we only need the post-action snapshot).
    const postPhase = useSessionStore.getState().phase;
    if (postPhase === "error") {
      onSessionError();
    } else {
      setProblemQueue([]);
    }
  };

  const modeLabel = mode === "learn" ? "Learn" : mode === "practice" ? "Practice" : "Mock Test";
  const modeIcon = mode === "learn" ? ("book-outline" as const) : mode === "practice" ? ("pencil-outline" as const) : ("document-text-outline" as const);
  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const hasNoProblems = totalProblems === 0;

  const getGoButtonLabel = () => {
    if (mode === "mock_test" && totalProblems > 0) {
      const examCount = mockExamType === "generate_similar" ? mockGenerateCount : totalProblems;
      return `Start Exam (${examCount})`;
    }
    if (problemQueue.length > 0) return `Start ${modeLabel} (${totalProblems})`;
    return "Go";
  };
  const goButtonLabel = getGoButtonLabel();

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.backButton}>
          <BackButton onPress={onBack} />
        </View>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>Enter a Problem</Text>
          <View style={styles.modeChip}>
            <Ionicons name={modeIcon} size={16} color={colors.primary} style={{ marginRight: spacing.xs }} />
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

        {/* Mock test config */}
        {mode === "mock_test" && totalProblems > 0 && (
          <View style={[styles.mockConfigContainer, shadows.sm]}>
            <View style={styles.mockConfigHeader}>
              <Ionicons name="settings-outline" size={16} color={colors.primary} />
              <Text style={styles.mockConfigTitle}>Exam Settings</Text>
            </View>

            {/* Exam type segmented control */}
            <View style={styles.mockSection}>
              <View style={[styles.mockSegment, shadows.sm]}>
                <AnimatedPressable
                  style={[styles.mockSegmentBtn, mockExamType === "use_as_exam" && [styles.mockSegmentBtnActive, shadows.sm]]}
                  onPress={() => setMockExamType("use_as_exam")}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={15}
                    color={mockExamType === "use_as_exam" ? colors.primary : colors.textMuted}
                    style={{ marginBottom: 2 }}
                  />
                  <Text style={[styles.mockSegmentText, mockExamType === "use_as_exam" && styles.mockSegmentTextActive]}>
                    Use as Exam
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.mockSegmentBtn, mockExamType === "generate_similar" && [styles.mockSegmentBtnActive, shadows.sm]]}
                  onPress={() => setMockExamType("generate_similar")}
                >
                  <Ionicons
                    name="shuffle-outline"
                    size={15}
                    color={mockExamType === "generate_similar" ? colors.primary : colors.textMuted}
                    style={{ marginBottom: 2 }}
                  />
                  <Text style={[styles.mockSegmentText, mockExamType === "generate_similar" && styles.mockSegmentTextActive]}>
                    Generate Similar
                  </Text>
                </AnimatedPressable>
              </View>
              <Text style={styles.mockSegmentHint}>
                {mockExamType === "use_as_exam"
                  ? `Your ${totalProblems} problem${totalProblems > 1 ? "s" : ""} will be the exam`
                  : "New problems generated from your inputs"}
              </Text>
            </View>

            {/* Question count stepper (only for generate similar) */}
            {mockExamType === "generate_similar" && (
              <>
                <View style={styles.mockDivider} />
                <View style={styles.mockSettingRow}>
                  <View style={styles.mockSettingLabel}>
                    <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.mockSettingText}>Questions</Text>
                  </View>
                  <View style={styles.mockMiniStepper}>
                    <AnimatedPressable
                      style={[styles.mockMiniBtn, mockGenerateCount <= 1 && styles.mockMiniBtnDisabled]}
                      onPress={() => setMockGenerateCount(Math.max(1, mockGenerateCount - 1))}
                      scaleDown={0.9}
                      disabled={mockGenerateCount <= 1}
                    >
                      <Ionicons name="remove" size={16} color={mockGenerateCount <= 1 ? colors.textMuted : colors.primary} />
                    </AnimatedPressable>
                    <Text style={styles.mockMiniValue}>{mockGenerateCount}</Text>
                    <AnimatedPressable
                      style={[styles.mockMiniBtn, mockGenerateCount >= 15 && styles.mockMiniBtnDisabled]}
                      onPress={() => setMockGenerateCount(Math.min(15, mockGenerateCount + 1))}
                      scaleDown={0.9}
                      disabled={mockGenerateCount >= 15}
                    >
                      <Ionicons name="add" size={16} color={mockGenerateCount >= 15 ? colors.textMuted : colors.primary} />
                    </AnimatedPressable>
                  </View>
                </View>
              </>
            )}

            {/* Time limit */}
            <View style={styles.mockDivider} />
            <View style={styles.mockSettingRow}>
              <View style={styles.mockSettingLabel}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.mockSettingText}>Time Limit</Text>
              </View>
              {mockUntimed ? (
                <AnimatedPressable
                  style={styles.mockUntimedChip}
                  onPress={() => setMockUntimed(false)}
                >
                  <Ionicons name="infinite-outline" size={14} color={colors.primary} />
                  <Text style={styles.mockUntimedChipText}>Untimed</Text>
                </AnimatedPressable>
              ) : (
                <View style={styles.mockTimeGroup}>
                  <View style={styles.mockMiniStepper}>
                    <AnimatedPressable
                      style={[styles.mockMiniBtn, mockTimeLimitMinutes <= 1 && styles.mockMiniBtnDisabled]}
                      onPress={() => setMockTimeLimitMinutes(Math.max(1, mockTimeLimitMinutes - 5))}
                      scaleDown={0.9}
                      disabled={mockTimeLimitMinutes <= 1}
                    >
                      <Ionicons name="remove" size={16} color={mockTimeLimitMinutes <= 1 ? colors.textMuted : colors.primary} />
                    </AnimatedPressable>
                    <Text style={styles.mockMiniValue}>{mockTimeLimitMinutes}<Text style={styles.mockMiniUnit}> min</Text></Text>
                    <AnimatedPressable
                      style={[styles.mockMiniBtn, mockTimeLimitMinutes >= 180 && styles.mockMiniBtnDisabled]}
                      onPress={() => setMockTimeLimitMinutes(Math.min(180, mockTimeLimitMinutes + 5))}
                      scaleDown={0.9}
                      disabled={mockTimeLimitMinutes >= 180}
                    >
                      <Ionicons name="add" size={16} color={mockTimeLimitMinutes >= 180 ? colors.textMuted : colors.primary} />
                    </AnimatedPressable>
                  </View>
                  <AnimatedPressable
                    style={styles.mockUntimedLink}
                    onPress={() => setMockUntimed(true)}
                  >
                    <Text style={styles.mockUntimedLinkText}>No limit</Text>
                  </AnimatedPressable>
                </View>
              )}
            </View>
          </View>
        )}

        <GradientButton
          onPress={handleGo}
          label={goButtonLabel}
          loading={isLoading}
          disabled={hasNoProblems}
          style={styles.goButton}
        />

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

      {/* "Want more practice?" prompt */}
      <Modal
        visible={showMorePrompt}
        animationType="fade"
        transparent
        onRequestClose={() => setShowMorePrompt(false)}
      >
        <View style={styles.promptOverlay}>
          <View style={[styles.promptContent, shadows.lg]}>
            <Text style={styles.promptTitle}>Want more practice?</Text>
            <Text style={styles.promptSubtitle}>
              Generate similar problems to practice with
            </Text>

            <View style={styles.stepper}>
              <AnimatedPressable
                scaleDown={0.9}
                onPress={() => setSimilarCount(Math.max(0, similarCount - 1))}
              >
                <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                  <Ionicons name="remove" size={20} color={colors.white} />
                </LinearGradient>
              </AnimatedPressable>
              <Text style={styles.countValue}>{similarCount}</Text>
              <AnimatedPressable
                scaleDown={0.9}
                onPress={() => setSimilarCount(Math.min(20, similarCount + 1))}
              >
                <LinearGradient colors={gradients.primary} style={styles.stepperButton}>
                  <Ionicons name="add" size={20} color={colors.white} />
                </LinearGradient>
              </AnimatedPressable>
            </View>
            <Text style={styles.countHint}>
              Total: {1 + similarCount} problem{similarCount > 0 ? "s" : ""}
            </Text>

            <TouchableOpacity
              style={styles.promptStartBtn}
              onPress={() => {
                setShowMorePrompt(false);
                startProblems(collectProblems(), similarCount);
              }}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.promptPrimaryGradient}
              >
                <Text style={styles.promptPrimaryText}>
                  {similarCount > 0 ? `Start Practice (${1 + similarCount})` : "Just this one"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    marginBottom: spacing.md,
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
    padding: spacing.lg,
    ...typography.body,
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
  goText: { color: colors.white, ...typography.button },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  error: { color: colors.error, ...typography.caption, flex: 1 },
  retryLink: {
    ...typography.label,
    color: colors.primary,
    marginLeft: spacing.sm,
  },
  buttonDisabled: { opacity: 0.4 },
  // "Want more practice?" prompt
  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  promptContent: {
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    alignItems: "center",
  },
  promptTitle: {
    ...typography.heading,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  promptSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xxl,
  },
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
  countValue: { ...typography.title, color: colors.text, minWidth: 30, textAlign: "center" as const },
  countHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  promptStartBtn: {
    width: "100%",
    borderRadius: radii.md,
    overflow: "hidden" as const,
    marginTop: spacing.xxl,
  },
  promptPrimaryGradient: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  promptPrimaryText: {
    ...typography.button,
    color: colors.white,
  },
  // Mock test config styles
  mockConfigContainer: {
    width: "100%",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: spacing.lg,
    padding: spacing.xl,
  },
  mockConfigHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  mockConfigTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  mockSection: {
    marginBottom: spacing.xs,
  },
  mockSegment: {
    flexDirection: "row" as const,
    backgroundColor: colors.inputBg,
    borderRadius: radii.md,
    padding: 3,
    gap: 3,
  },
  mockSegmentBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.sm + 1,
    alignItems: "center" as const,
    gap: 2,
  },
  mockSegmentBtnActive: {
    backgroundColor: colors.white,
  },
  mockSegmentText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textMuted,
  },
  mockSegmentTextActive: {
    color: colors.primary,
  },
  mockSegmentHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center" as const,
    marginTop: spacing.sm,
  },
  mockDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.lg,
  },
  mockSettingRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  mockSettingLabel: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  mockSettingText: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
  },
  mockMiniStepper: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: colors.inputBg,
    borderRadius: radii.sm,
    paddingHorizontal: 2,
    paddingVertical: 2,
    gap: 0,
  },
  mockMiniBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.sm - 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  mockMiniBtnDisabled: {
    opacity: 0.35,
  },
  mockMiniValue: {
    ...typography.bodyBold,
    color: colors.text,
    minWidth: 36,
    textAlign: "center" as const,
    fontSize: 15,
  },
  mockMiniUnit: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "400" as const,
    fontSize: 12,
  },
  mockUntimedChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    backgroundColor: colors.primaryBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  mockUntimedChipText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
  },
  mockTimeGroup: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
  },
  mockUntimedLink: {
    paddingVertical: spacing.xs,
  },
  mockUntimedLinkText: {
    ...typography.caption,
    color: colors.primary,
    textDecorationLine: "underline" as const,
  },
});
