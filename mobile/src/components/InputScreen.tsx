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
import { cleanMathPreview } from "./HistoryCards";
import { ImagePreview } from "./ImagePreview";
import { MathKeyboard } from "./MathKeyboard";
import { MockTestConfig } from "./MockTestConfig";
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { RectangleSelector } from "./RectangleSelector";
import { type Mode } from "./ModeSelectScreen";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
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
  const [quotaConfirm, setQuotaConfirm] = useState(false);
  const { show: showUpgrade, promptProps, paywallVisible, paywallTrigger, closePaywall } = useUpgradePrompt();

  const isPro = useEntitlementStore((s) => s.isPro);
  const sessionsRemaining = useEntitlementStore((s) => s.sessionsRemaining);
  const scansRemaining = useEntitlementStore((s) => s.scansRemaining);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  const maxQueueSize = isPro ? MAX_PROBLEMS : Math.min(MAX_PROBLEMS, sessionsRemaining());

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
  } = useImageExtraction(
    problemQueue.length, maxQueueSize, setError, subject,
    isPro ? undefined : scansRemaining,
    isPro ? undefined : () => showUpgrade("image_scan", "Scan Limit Reached", `You've used all ${dailyScansLimit} image scans for today. Upgrade to Pro for unlimited scans.`),
  );

  const {
    problemImages,
  } = useSessionStore();

  const handleConfirmExtraction = () => {
    const items = getSelectedWithImages();
    const remaining = maxQueueSize - problemQueue.length;
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
    fetchEntitlements();
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
    if (!text) return;
    if (!isPro && problemQueue.length >= maxQueueSize) {
      const remaining = sessionsRemaining();
      const msg = problemQueue.length > 0
        ? `Your queue is full — you have ${remaining} problem${remaining !== 1 ? "s" : ""} remaining today. Remove one to add another, or upgrade to Pro.`
        : `You've used all ${dailySessionsLimit} problems for today. Upgrade to Pro for unlimited access.`;
      showUpgrade("create_session", "Queue Full", msg);
      return;
    }
    if (problemQueue.length >= MAX_PROBLEMS) return;
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

    // Enforce session limit for free users
    if (!isPro && sessionsRemaining() <= 0) {
      showUpgrade("create_session", "Daily Limit Reached", `You've used all ${dailySessionsLimit} problems for today. Upgrade to Pro for unlimited access.`);
      return;
    }

    // Quota confirmation for multi-problem sessions
    if (!isPro && allProblems.length > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);

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
      <ImagePreview
        imageUri={imageUri}
        extracting={extracting}
        error={error}
        hasManualSelect={!!imageDimensions}
        onExtractAll={extractFullImage}
        onManualSelect={startManualSelect}
        onBack={cancelPreview}
      />
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
        maxRectangles={Math.min(10, maxQueueSize - problemQueue.length, scansRemaining())}
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
              disabled={extracting || problemQueue.length >= maxQueueSize}
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
              disabled={extracting || problemQueue.length >= maxQueueSize}
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
          {input.trim() && problemQueue.length < maxQueueSize ? (
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
                  <Text style={styles.queueText} numberOfLines={1}>{cleanMathPreview(problem)}</Text>
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
            {problemQueue.length < maxQueueSize ? (
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
              <Text style={styles.queueMaxHint}>
                {!isPro && sessionsRemaining() <= MAX_PROBLEMS
                  ? `${sessionsRemaining()} problems remaining today`
                  : `Maximum ${MAX_PROBLEMS} problems`}
              </Text>
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

        {quotaConfirm ? (
          <View style={styles.quotaConfirmCard}>
            <View style={styles.quotaConfirmHeader}>
              <Ionicons name="alert-circle" size={20} color={colors.warningDark} />
              <Text style={styles.quotaConfirmTitle}>Confirm Usage</Text>
            </View>
            <Text style={styles.quotaConfirmText}>
              This will use <Text style={styles.quotaConfirmBold}>{collectProblems().length}</Text> of your <Text style={styles.quotaConfirmBold}>{sessionsRemaining()}</Text> remaining problems today.
            </Text>
            <View style={styles.quotaConfirmButtons}>
              <TouchableOpacity
                style={styles.quotaConfirmCancel}
                onPress={() => setQuotaConfirm(false)}
              >
                <Text style={styles.quotaConfirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <GradientButton
                onPress={handleGo}
                label="Continue"
                loading={isLoading}
                gradient={modeGradient}
                style={styles.quotaConfirmButton}
              />
            </View>
          </View>
        ) : (
          <GradientButton
            onPress={handleGo}
            label={goButtonLabel}
            loading={isLoading}
            disabled={hasNoProblems}
            gradient={modeGradient}
            style={styles.goButton}
          />
        )}

        {!isPro && !quotaConfirm && sessionsRemaining() < Infinity && (() => {
          const remaining = sessionsRemaining();
          const limit = dailySessionsLimit as number;
          const pct = limit > 0 ? (limit - remaining) / limit : 0;
          return (
            <View style={styles.quotaFooterRow}>
              <View style={styles.quotaBar}>
                <View style={[styles.quotaBarFill, { width: `${Math.min(pct * 100, 100)}%` }, pct >= 1 && styles.quotaBarFillDanger, pct >= 0.8 && pct < 1 && styles.quotaBarFillWarning]} />
              </View>
              <Text style={styles.quotaFooterText}>
                {remaining} of {limit} remaining today
              </Text>
            </View>
          );
        })()}

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
        maxProblems={maxQueueSize}
        onToggle={toggleSelected}
        onStartEdit={startEdit}
        onEditText={setEditingText}
        onFinishEdit={finishEdit}
        onConfirm={handleConfirmExtraction}
        onDismiss={dismissExtraction}
        onRetry={retryExtraction}
        onManualSelect={imageUri && imageDimensions ? startManualSelect : undefined}
      />

      <UpgradePrompt {...promptProps} />
      <PaywallScreen
        visible={paywallVisible}
        onClose={closePaywall}
        onPurchaseComplete={() => { closePaywall(); fetchEntitlements(); }}
        trigger={paywallTrigger}
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
  quotaConfirmCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warningDark,
    backgroundColor: colors.warningBg,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  quotaConfirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  quotaConfirmTitle: {
    ...typography.bodyBold,
    color: colors.warningDark,
    fontSize: 14,
  },
  quotaConfirmText: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  quotaConfirmBold: {
    fontWeight: "700",
    color: colors.warningDark,
  },
  quotaConfirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quotaConfirmButton: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "center",
  },
  quotaConfirmCancel: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  quotaConfirmCancelText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 14,
  },
  quotaFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  quotaBar: {
    flex: 1,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  quotaBarFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  quotaBarFillWarning: {
    backgroundColor: colors.warningDark,
  },
  quotaBarFillDanger: {
    backgroundColor: colors.error,
  },
  quotaFooterText: {
    ...typography.caption,
    color: colors.textMuted,
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
