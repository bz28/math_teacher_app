import { useEffect, useRef, useState } from "react";
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
  subject: string;
  onBack: () => void;
  onSessionStart: () => void;
  onSessionError: () => void;
}

export function InputScreen({
  mode,
  subject,
  onBack,
  onSessionStart,
  onSessionError,
}: Props) {
  const problemQueue = useSessionStore((s) => s.problemQueue);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Mock test config state
  const [mockExamType, setMockExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [mockTimeLimitMinutes, setMockTimeLimitMinutes] = useState(30);
  const [mockUntimed, setMockUntimed] = useState(false);

  const {
    extracting,
    extractionProgress,
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
  } = useImageExtraction(problemQueue.length, MAX_PROBLEMS, setError, subject);

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
    startLearnQueue,
    startMockTest,
    setSubject,
    phase: sessionPhase,
    error: sessionError,
  } = useSessionStore();

  // Keep store subject in sync with prop
  useEffect(() => { setSubject(subject); }, [subject, setSubject]);

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
      const generateCount = mockExamType === "generate_similar" ? allProblems.length : 0;
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

    await startProblems(allProblems);
  };

  const startProblems = async (allProblems: string[]) => {
    setError(null);

    // Navigate immediately — session screen shows skeleton while loading
    onSessionStart();

    if (allProblems.length === 1) {
      await startSession(allProblems[0], mode);
    } else {
      await startLearnQueue(allProblems);
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

  const modeLabel = mode === "learn" ? "Learn" : "Mock Test";
  const modeIcon = mode === "learn" ? ("book-outline" as const) : ("document-text-outline" as const);
  const modeColor = mode === "learn" ? colors.primary : colors.warningDark;
  const modeBg = mode === "learn" ? colors.primaryBg : colors.warningBg;
  const modeGradient = (mode === "learn" ? "primary" : "warning") as keyof typeof gradients;
  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const hasNoProblems = totalProblems === 0;

  const getGoButtonLabel = () => {
    if (totalProblems === 0) return "Go";
    if (mode === "mock_test") return `Start Exam (${totalProblems})`;
    return `Start ${modeLabel} (${totalProblems})`;
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
          <Text style={styles.headerTitle}>
            {mode === "learn" ? "What do you need\nhelp with?" : "Build your exam"}
          </Text>
          <View style={[styles.modeChip, { backgroundColor: modeBg }]}>
            <Ionicons name={modeIcon} size={16} color={modeColor} style={{ marginRight: spacing.xs }} />
            <Text style={[styles.modeChipText, { color: modeColor }]}>{modeLabel}</Text>
          </View>
        </View>

        {/* Primary actions: camera & gallery */}
        <View style={styles.captureRow}>
          <View style={styles.captureCardWrap}>
            <AnimatedPressable
              style={[extracting && styles.captureCardDisabled]}
              onPress={() => pickImage("camera")}
              disabled={extracting || problemQueue.length >= MAX_PROBLEMS}
              scaleDown={0.96}
            >
              <LinearGradient
                colors={gradients[modeGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.captureCard}
              >
                <Ionicons name="camera" size={26} color={colors.white} />
                <Text style={styles.captureLabel}>Take a photo</Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
          <View style={styles.captureCardWrap}>
            <AnimatedPressable
              style={[extracting && styles.captureCardDisabled]}
              onPress={() => pickImage("gallery")}
              disabled={extracting || problemQueue.length >= MAX_PROBLEMS}
              scaleDown={0.96}
            >
              <LinearGradient
                colors={gradients[modeGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.captureCard}
              >
                <Ionicons name="images" size={26} color={colors.white} />
                <Text style={styles.captureLabel}>Choose photo</Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </View>

        {extracting && (
          <View style={[styles.extractingCard, shadows.sm]}>
            <ActivityIndicator size="large" color={modeColor} />
            <Text style={styles.extractingTitle}>Reading your problems...</Text>
            <Text style={styles.extractingSubtitle}>
              {extractionProgress
                ? `Processing image ${extractionProgress.done + 1} of ${extractionProgress.total}`
                : "This usually takes a few seconds"}
            </Text>
          </View>
        )}

        {/* Divider */}
        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>or type it in</Text>
          <View style={styles.orLine} />
        </View>

        {/* Secondary action: text input */}
        <View style={styles.inputWrapper}>
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
            returnKeyType="next"
            onSubmitEditing={handleAddToQueue}
            inputAccessoryViewID="math-input"
          />
          {input.trim() && problemQueue.length < MAX_PROBLEMS ? (
            <TouchableOpacity style={styles.addToQueueBtn} onPress={handleAddToQueue} activeOpacity={0.6}>
              <Ionicons name="add-circle" size={18} color={modeColor} />
              <Text style={[styles.addToQueueText, { color: modeColor }]}>Add to queue</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Problem queue */}
        {problemQueue.length > 0 && (
          <View style={[styles.queueContainer, shadows.sm]}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueHeaderText}>
                {problemQueue.length} problem{problemQueue.length !== 1 ? "s" : ""} queued
              </Text>
            </View>
            <ScrollView style={styles.queueScroll} nestedScrollEnabled>
              {problemQueue.map((problem, i) => (
                <TouchableOpacity
                  key={`${i}-${problem}`}
                  style={styles.queueRow}
                  onPress={() => handleEditFromQueue(i)}
                  activeOpacity={0.6}
                >
                  <View style={styles.queueBadge}>
                    <Text style={styles.queueBadgeText}>{i + 1}</Text>
                  </View>
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
            </ScrollView>
            {problemQueue.length < MAX_PROBLEMS ? (
              <View style={styles.queueAddMore}>
                <TouchableOpacity
                  style={styles.queueAddMoreBtn}
                  onPress={() => inputRef.current?.focus()}
                  activeOpacity={0.6}
                >
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                  <Text style={styles.queueAddMoreText}>Type another</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.queueAddMoreBtn}
                  onPress={() => pickImage("camera")}
                  disabled={extracting}
                  activeOpacity={0.6}
                >
                  <Ionicons name="camera-outline" size={16} color={colors.primary} />
                  <Text style={styles.queueAddMoreText}>Scan more</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.queueMaxHint}>Maximum {MAX_PROBLEMS} problems</Text>
            )}
          </View>
        )}

        {/* Hint: generate similar feature (mock test, empty queue) */}
        {mode === "mock_test" && problemQueue.length === 0 && (
          <View style={[styles.featureHint, shadows.sm]}>
            <Ionicons name="sparkles" size={20} color={colors.primary} />
            <View style={styles.featureHintContent}>
              <Text style={styles.featureHintTitle}>Generate a full exam from one problem</Text>
              <Text style={styles.featureHintDesc}>
                Add a problem and we'll create similar questions to build a complete practice exam
              </Text>
            </View>
          </View>
        )}

        <MathKeyboard onInsert={handleInsert} accessoryID="math-input" />

        {/* Mock test config — only show once problems are queued */}
        {mode === "mock_test" && problemQueue.length > 0 && (
          <View style={[styles.mockConfigContainer, shadows.sm]}>
            <View style={styles.mockConfigHeader}>
              <Ionicons name="settings-outline" size={16} color={colors.primary} />
              <Text style={styles.mockConfigTitle}>Exam Settings</Text>
            </View>

            {/* Exam type segmented control */}
            <View style={styles.mockSection}>
              <View style={styles.mockSegment}>
                <TouchableOpacity
                  style={[styles.mockSegmentBtn, mockExamType === "use_as_exam" && [styles.mockSegmentBtnActive, shadows.sm]]}
                  onPress={() => setMockExamType("use_as_exam")}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mockSegmentText, mockExamType === "use_as_exam" && styles.mockSegmentTextActive]}>
                    Use as Exam
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mockSegmentBtn, mockExamType === "generate_similar" && [styles.mockSegmentBtnActive, shadows.sm]]}
                  onPress={() => setMockExamType("generate_similar")}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mockSegmentText, mockExamType === "generate_similar" && styles.mockSegmentTextActive]}>
                    Generate Similar
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.mockSegmentHint}>
                {mockExamType === "use_as_exam"
                  ? `Your ${problemQueue.length} problem${problemQueue.length !== 1 ? "s" : ""} will be the exam`
                  : `1 similar problem generated per queued problem (${problemQueue.length} total)`}
              </Text>
            </View>

            {/* Time limit */}
            <View style={styles.mockDivider} />
            <View style={styles.mockSettingRow}>
              <View style={styles.mockSettingLabel}>
                <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.mockSettingText}>Time Limit</Text>
              </View>
              <AnimatedPressable
                style={[styles.mockToggleChip, !mockUntimed && styles.mockToggleChipActive]}
                onPress={() => setMockUntimed(!mockUntimed)}
              >
                <Ionicons
                  name={mockUntimed ? "infinite-outline" : "timer-outline"}
                  size={14}
                  color={!mockUntimed ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.mockToggleChipText, !mockUntimed && styles.mockToggleChipTextActive]}>
                  {mockUntimed ? "Off" : "On"}
                </Text>
              </AnimatedPressable>
            </View>
            {!mockUntimed && (
              <View style={styles.mockTimeStepperRow}>
                <View style={styles.mockMiniStepper}>
                  <AnimatedPressable
                    style={[styles.mockMiniBtn, mockTimeLimitMinutes <= 1 && styles.mockMiniBtnDisabled]}
                    onPress={() => setMockTimeLimitMinutes(Math.max(1, mockTimeLimitMinutes - 5))}
                    scaleDown={0.9}
                    disabled={mockTimeLimitMinutes <= 1}
                  >
                    <Ionicons name="remove" size={16} color={mockTimeLimitMinutes <= 1 ? colors.textMuted : colors.primary} />
                  </AnimatedPressable>
                  <Text style={styles.mockMiniValue}>{mockTimeLimitMinutes}</Text>
                  <AnimatedPressable
                    style={[styles.mockMiniBtn, mockTimeLimitMinutes >= 180 && styles.mockMiniBtnDisabled]}
                    onPress={() => setMockTimeLimitMinutes(Math.min(180, mockTimeLimitMinutes + 5))}
                    scaleDown={0.9}
                    disabled={mockTimeLimitMinutes >= 180}
                  >
                    <Ionicons name="add" size={16} color={mockTimeLimitMinutes >= 180 ? colors.textMuted : colors.primary} />
                  </AnimatedPressable>
                </View>
                <Text style={styles.mockTimeUnit}>minutes</Text>
              </View>
            )}
          </View>
        )}

        <GradientButton
          onPress={handleGo}
          label={goButtonLabel}
          loading={isLoading}
          disabled={hasNoProblems}
          gradient={modeGradient}
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
  header: {
    marginBottom: spacing.xl,
  },
  headerTitle: {
    ...typography.hero,
    color: colors.text,
    marginBottom: spacing.md,
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modeChipText: { ...typography.label },

  // Primary capture cards
  captureRow: {
    flexDirection: "row",
    gap: spacing.md,
    width: "100%",
    marginBottom: spacing.lg,
  },
  captureCardWrap: {
    flex: 1,
  },
  captureCard: {
    alignItems: "center",
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  captureCardDisabled: {
    opacity: 0.45,
  },
  captureLabel: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 14,
    marginTop: spacing.sm,
    marginBottom: 2,
  },

  // "or type it in" divider
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    width: "100%",
    marginBottom: spacing.md,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  orText: {
    ...typography.caption,
    color: colors.textMuted,
  },

  // Text input (secondary)
  inputWrapper: {
    width: "100%",
    marginBottom: spacing.xs,
  },
  inputField: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    ...typography.body,
    backgroundColor: colors.inputBg,
    color: colors.text,
  },
  addToQueueBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addToQueueText: {
    ...typography.label,
    fontSize: 13,
  },

  // Extracting
  extractingCard: {
    width: "100%",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.lg,
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

  // Feature hint
  featureHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  featureHintContent: {
    flex: 1,
  },
  featureHintTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  featureHintDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },

  // Queue
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
  queueBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
    justifyContent: "center",
    alignItems: "center",
  },
  queueBadgeText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 12,
  },
  queueText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  queueRemove: {
    padding: spacing.xs,
  },
  queueScroll: {
    maxHeight: 180,
  },
  queueHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  queueHeaderText: {
    ...typography.label,
    color: colors.primary,
  },
  queueAddMore: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xs,
  },
  queueAddMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
  },
  queueAddMoreText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
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
  },
  mockSegmentBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.sm + 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  mockSegmentBtnActive: {
    backgroundColor: colors.white,
  },
  mockSegmentText: {
    ...typography.label,
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
  mockToggleChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.inputBg,
  },
  mockToggleChipActive: {
    backgroundColor: colors.primaryBg,
  },
  mockToggleChipText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textMuted,
  },
  mockToggleChipTextActive: {
    color: colors.primary,
  },
  mockTimeStepperRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  mockTimeUnit: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
