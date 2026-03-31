import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { GradientButton } from "./GradientButton";
import { ExtractionModal } from "./ExtractionModal";
import { MathKeyboard } from "./MathKeyboard";
import { MockTestConfig } from "./MockTestConfig";
import { RectangleSelector } from "./RectangleSelector";
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
  const [mockUntimed, setMockUntimed] = useState(true);
  const [mockMultipleChoice, setMockMultipleChoice] = useState(true);

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
    phase: extractionPhase,
    imageUri,
    imageDimensions,
    pickImage,
    extractFullImage,
    startManualSelect,
    confirmRectangles,
    cancelSelection,
    cancelPreview,
    dismiss: dismissExtraction,
    retry: retryExtraction,
    toggleSelected,
    startEdit,
    setEditingText,
    finishEdit,
    getSelectedProblems,
    getSelectedWithImages,
  } = useImageExtraction(problemQueue.length, MAX_PROBLEMS, setError, subject);

  const {
    problemImages,
  } = useSessionStore();

  const handleConfirmExtraction = () => {
    const items = getSelectedWithImages();
    const remaining = MAX_PROBLEMS - problemQueue.length;
    const toAdd = items.slice(0, remaining);
    if (toAdd.length > 0) {
      const newQueue = [...problemQueue, ...toAdd.map((p) => p.text)];
      const newImages = { ...problemImages };
      for (const item of toAdd) {
        if (item.image) newImages[item.text] = item.image;
      }
      setProblemQueue(newQueue);
      useSessionStore.setState({ problemImages: newImages });
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
      await startMockTest(allProblems, generateCount, timeLimitMinutes, mockMultipleChoice);
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

  // Image preview phase — choose extraction method
  if (extractionPhase === "preview" && imageUri) {
    return (
      <View style={styles.previewContainer}>
        <SafeAreaView style={styles.previewSafe}>
          <View style={styles.previewHeader}>
            <AnimatedPressable onPress={cancelPreview} style={styles.previewBackBtn} scaleDown={0.9}>
              <Ionicons name="chevron-back" size={22} color={colors.white} />
            </AnimatedPressable>
            <Text style={styles.previewTitle}>Extract Problems</Text>
            <View style={styles.previewBackBtn} />
          </View>

          <View style={styles.previewImageWrap}>
            <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
          </View>

          <View style={styles.previewActions}>
            {extracting ? (
              <View style={styles.previewLoadingCard}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.previewLoadingTitle}>Extracting problems...</Text>
                <Text style={styles.previewLoadingSubtitle}>This usually takes a few seconds</Text>
              </View>
            ) : (
              <>
                {error && (
                  <View style={styles.previewErrorCard}>
                    <Ionicons name="alert-circle" size={18} color={colors.warningDark} />
                    <Text style={styles.previewErrorText}>{error}</Text>
                  </View>
                )}
                <GradientButton
                  onPress={extractFullImage}
                  label="Extract All Problems"
                  style={styles.previewMainBtn}
                />
                {imageDimensions && (
                  <AnimatedPressable
                    onPress={startManualSelect}
                    style={styles.previewSecondaryBtn}
                    scaleDown={0.97}
                  >
                    <Ionicons name="crop-outline" size={18} color={colors.textSecondary} />
                    <Text style={styles.previewSecondaryText}>Select areas manually</Text>
                  </AnimatedPressable>
                )}
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Rectangle selection phase — full screen overlay
  if (extractionPhase === "selecting" && imageUri && imageDimensions) {
    return (
      <RectangleSelector
        imageUri={imageUri}
        imageDimensions={imageDimensions}
        onConfirm={(rects) => confirmRectangles(rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })))}
        onCancel={cancelSelection}
        maxRectangles={Math.min(10, MAX_PROBLEMS - problemQueue.length)}
      />
    );
  }

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

        <MathKeyboard onInsert={handleInsert} accessoryID="math-input" />

        {/* Mock test config — always visible so students see what they're building */}
        {mode === "mock_test" && (
          <MockTestConfig
            examType={mockExamType}
            onExamTypeChange={setMockExamType}
            untimed={mockUntimed}
            onUntimedChange={setMockUntimed}
            timeLimitMinutes={mockTimeLimitMinutes}
            onTimeLimitChange={setMockTimeLimitMinutes}
            multipleChoice={mockMultipleChoice}
            onMultipleChoiceChange={setMockMultipleChoice}
          />
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
        onManualSelect={imageUri && imageDimensions ? startManualSelect : undefined}
      />

    </>
  );
}

const styles = StyleSheet.create({
  // Preview screen
  previewContainer: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
  },
  previewSafe: {
    flex: 1,
  },
  previewHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewBackBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.xl,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  previewTitle: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 17,
    flex: 1,
    textAlign: "center" as const,
  },
  previewImageWrap: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
  },
  previewImage: {
    width: "100%" as const,
    height: "100%" as const,
  },
  previewActions: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    ...shadows.lg,
  },
  previewMainBtn: {
    borderRadius: radii.md,
  },
  previewSecondaryBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  previewSecondaryText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 14,
  },
  previewLoadingCard: {
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  previewLoadingTitle: {
    ...typography.bodyBold,
    color: colors.text,
  },
  previewLoadingSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  previewErrorCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
  },
  previewErrorText: {
    ...typography.caption,
    color: colors.warningDark,
    flex: 1,
  },

  // Main screen
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
});
