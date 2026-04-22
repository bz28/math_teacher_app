import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import { Coachmark } from "./Coachmark";
import { GradientButton } from "./GradientButton";
import { ExtractionModal } from "./ExtractionModal";
import { ImagePreview } from "./ImagePreview";
import { MockTestConfig } from "./MockTestConfig";
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { RectangleSelector } from "./RectangleSelector";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { EntitlementError } from "../services/api";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
import { useOnboardingFlags } from "../stores/onboardingFlags";
import { SubjectPills, getSubjectMeta } from "./SubjectPills";
import { useColors, spacing, radii, typography, shadows, gradients, type ColorPalette } from "../theme";

const MAX_PROBLEMS = 10;
const CHIP_PREVIEW_LIMIT = 30;
const SAMPLE_PROBLEM = "2x + 5 = 13";

// Queue chips show the problem text inline. Long word problems turn into
// awkward single-line ellipsis that cuts mid-word; hard-truncating before
// render keeps the pill compact and readable.
function truncateForChip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= CHIP_PREVIEW_LIMIT) return oneLine;
  return oneLine.slice(0, CHIP_PREVIEW_LIMIT).trimEnd() + "…";
}

type Mode = "learn" | "mock_test";

const MODES: { key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap; gradient: keyof typeof gradients }[] = [
  { key: "learn", label: "Learn", icon: "book-outline", gradient: "primary" },
  { key: "mock_test", label: "Mock Test", icon: "document-text-outline", gradient: "warning" },
];

interface Props {
  subject: string;
  onSubjectChange: (s: string) => void;
  onSessionStart: () => void;
  onSessionError: () => void;
}

export function SolveScreen({
  subject,
  onSubjectChange,
  onSessionStart,
  onSessionError,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaConfirm, setQuotaConfirm] = useState(false);
  const [mode, setMode] = useState<Mode>("learn");

  // Mock test config
  const [examType, setExamType] = useState<"use_as_exam" | "generate_similar">("use_as_exam");
  const [untimed, setUntimed] = useState(true);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [multipleChoice, setMultipleChoice] = useState(true);

  const problemQueue = useSessionStore((s) => s.problemQueue);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const problemImages = useSessionStore((s) => s.problemImages);
  const startSession = useSessionStore((s) => s.startSession);
  const startLearnQueue = useSessionStore((s) => s.startLearnQueue);
  const startMockTest = useSessionStore((s) => s.startMockTest);
  const setStoreSubject = useSessionStore((s) => s.setSubject);
  const sessionPhase = useSessionStore((s) => s.phase);
  const sessionError = useSessionStore((s) => s.error);

  const { show: showUpgrade, promptProps, paywallVisible, paywallTrigger, closePaywall } = useUpgradePrompt();

  // First-use onboarding: pre-fill a sample problem and show a one-time hint.
  const onboardingLoaded = useOnboardingFlags((s) => s.loaded);
  const hasCompletedFirstProblem = useOnboardingFlags((s) => s.hasCompletedFirstProblem);
  const markCompletedFirstProblem = useOnboardingFlags((s) => s.markCompletedFirstProblem);
  const didPrefillRef = useRef(false);

  // Subscribe to the raw used/limit primitives (NOT the sessionsRemaining /
  // scansRemaining function selectors — those return stable refs that never
  // fire re-renders, leaving the "X of Y left today" copy stale after
  // fetchEntitlements() refreshes the counters).
  const isPro = useEntitlementStore((s) => s.isPro);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const dailySessionsUsed = useEntitlementStore((s) => s.dailySessionsUsed);
  const dailyScansUsed = useEntitlementStore((s) => s.dailyScansUsed);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  const sessionsLeft = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);
  const scansLeft = isPro ? Infinity : Math.max(0, dailyScansLimit - dailyScansUsed);

  useEffect(() => { setStoreSubject(subject); }, [subject, setStoreSubject]);

  // Pre-fill the sample problem once on first launch when the user has no
  // existing state. Guarded by didPrefillRef so re-renders don't overwrite
  // the user if they clear the input.
  useEffect(() => {
    if (!onboardingLoaded || hasCompletedFirstProblem || didPrefillRef.current) return;
    if (input !== "" || problemQueue.length > 0) return;
    didPrefillRef.current = true;
    setInput(SAMPLE_PROBLEM);
  }, [onboardingLoaded, hasCompletedFirstProblem, input, problemQueue.length]);


  const maxQueueSize = isPro ? MAX_PROBLEMS : Math.min(MAX_PROBLEMS, sessionsLeft);
  const activeSubject = getSubjectMeta(subject);

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
    getSelectedWithImages,
  } = useImageExtraction(
    problemQueue.length,
    maxQueueSize,
    setError,
    subject,
    isPro ? undefined : () => scansLeft,
    isPro ? undefined : () => showUpgrade("image_scan", "Scan Limit Reached", `You've used all ${dailyScansLimit} image scans for today. Upgrade to Pro for unlimited scans.`),
  );

  // When the user engages with any alternative entry path (scan, gallery)
  // while the onboarding sample is still pre-filled, drop the sample so
  // their submission doesn't accidentally include both problems. Marking
  // the flag here also prevents the coachmark from re-appearing.
  const clearOnboardingSampleIfPresent = () => {
    if (hasCompletedFirstProblem) return;
    if (input === SAMPLE_PROBLEM) setInput("");
    markCompletedFirstProblem();
  };

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
      clearOnboardingSampleIfPresent();
    }
    dismissExtraction();
    fetchEntitlements();
  };

  const handleAddToQueue = () => {
    const text = input.trim();
    if (!text) return;
    if (!isPro && problemQueue.length >= maxQueueSize) {
      const remaining = sessionsLeft;
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
    if (!hasCompletedFirstProblem) markCompletedFirstProblem();
    inputRef.current?.focus();
  };

  const handleRemoveFromQueue = (index: number) => {
    setProblemQueue(problemQueue.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleEditFromQueue = (index: number) => {
    // Match main InputScreen behavior: load text back into input, remove from queue
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

  const handleSolve = async () => {
    const allProblems = collectProblems();
    if (allProblems.length === 0) return;
    setError(null);

    if (!isPro && sessionsLeft <= 0) {
      showUpgrade("create_session", "Daily Limit Reached", `You've used all ${dailySessionsLimit} problems for today. Upgrade to Pro for unlimited access.`);
      return;
    }

    if (!isPro && allProblems.length > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);

    if (!hasCompletedFirstProblem) markCompletedFirstProblem();
    onSessionStart();

    try {
      if (mode === "mock_test") {
        const generateCount = examType === "generate_similar" ? allProblems.length : 0;
        const timeLimit = untimed ? null : timeLimitMinutes;
        await startMockTest(allProblems, generateCount, timeLimit, multipleChoice);
      } else if (allProblems.length === 1) {
        await startSession(allProblems[0], "learn");
      } else {
        await startLearnQueue(allProblems);
      }
    } catch (e) {
      if (e instanceof EntitlementError) {
        onSessionError();
        showUpgrade(e.entitlement, "Daily Limit Reached", e.message);
        return;
      }
    }

    const postPhase = useSessionStore.getState().phase;
    if (postPhase === "error") {
      onSessionError();
    } else {
      setProblemQueue([]);
      setInput("");
    }
  };

  const totalProblems = problemQueue.length + (input.trim() ? 1 : 0);
  const isLoading = sessionPhase === "loading";
  const displayError = error ?? sessionError;

  // Subject-aware accent colors. MUST be declared BEFORE any early returns
  // (rules of hooks — useMemo cannot be skipped between renders).
  const theme = useMemo(
    () => ({ primary: activeSubject.primary, primaryBg: activeSubject.primaryBg }),
    [activeSubject.primary, activeSubject.primaryBg],
  );

  // Image preview phase
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
  if (extractionPhase === "selecting" && imageUri && imageDimensions) {
    return (
      <RectangleSelector
        imageUri={imageUri}
        imageDimensions={imageDimensions}
        onConfirm={(rects) => confirmRectangles(rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })))}
        onCancel={cancelSelection}
        maxRectangles={Math.max(0, Math.min(10, maxQueueSize - problemQueue.length, scansLeft))}
      />
    );
  }

  // Clamp extraction progress so it never reads "4 of 3"
  const progressDone = extractionProgress
    ? Math.min(extractionProgress.done + 1, extractionProgress.total)
    : 0;

  // Queue label adapts to mode + examType
  const queueLabel = (() => {
    const n = problemQueue.length;
    const noun = n === 1 ? "problem" : "problems";
    if (mode === "mock_test") {
      if (examType === "generate_similar") {
        return `${n} example${n !== 1 ? "s" : ""} → ${n} generated question${n !== 1 ? "s" : ""}`;
      }
      return `${n} question${n !== 1 ? "s" : ""}`;
    }
    return `${n} ${noun} queued`;
  })();

  // Solve button label
  const solveLabel = (() => {
    const verb = mode === "mock_test" ? "Test" : "Learn";
    if (totalProblems === 0 || totalProblems === 1) return verb;
    return `${verb} (${totalProblems})`;
  })();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Subject pill row — OUTSIDE KeyboardAvoidingView so it never reflows */}
      <SubjectPills active={subject} onChange={onSubjectChange} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Mode segmented control — full-width with sliding background */}
        <View style={styles.modeContainer}>
          <View style={[styles.modeTrack, { backgroundColor: colors.inputBg }]}>
            {MODES.map((m) => {
              const isActive = m.key === mode;
              return (
                <TouchableOpacity
                  key={m.key}
                  onPress={() => setMode(m.key)}
                  style={[
                    styles.modeTab,
                    isActive && { backgroundColor: theme.primary, borderRadius: radii.pill },
                  ]}
                  accessibilityRole="tab"
                  accessibilityLabel={m.label}
                  accessibilityState={{ selected: isActive }}
                >
                  <Ionicons
                    name={m.icon}
                    size={16}
                    color={isActive ? colors.white : colors.textMuted}
                  />
                  <Text style={[styles.modeTabText, isActive && { color: colors.white }]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.greetingTitle}>
            {mode === "mock_test" ? "What do you want to test?" : "What do you want to learn?"}
          </Text>

          {/* First-use hint. Dismissed on tap or as soon as the user adds
              any problem (the mark-completed effect hides it). */}
          <View style={styles.coachmarkWrap}>
            <Coachmark
              visible={onboardingLoaded && !hasCompletedFirstProblem}
              text="Welcome to Veradic! We added a sample problem — tap the + to add it, then Solve to see how Learn Mode works."
              onDismiss={() => markCompletedFirstProblem()}
            />
          </View>

          {/* Mock Test config — shown at the TOP when in test mode */}
          {mode === "mock_test" && (
            <MockTestConfig
              examType={examType}
              onExamTypeChange={setExamType}
              untimed={untimed}
              onUntimedChange={setUntimed}
              timeLimitMinutes={timeLimitMinutes}
              onTimeLimitChange={setTimeLimitMinutes}
              multipleChoice={multipleChoice}
              onMultipleChoiceChange={setMultipleChoice}
              themeColor={theme.primary}
            />
          )}

          {/* SNAP — gradient hero card */}
          <AnimatedPressable
            onPress={() => pickImage("camera")}
            disabled={extracting || problemQueue.length >= maxQueueSize}
            scaleDown={0.97}
            accessibilityRole="button"
            accessibilityLabel="Snap a photo of a problem"
          >
            <LinearGradient
              colors={gradients[activeSubject.gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.snapCard, shadows.lg, extracting && styles.cardDisabled]}
            >
              <View style={styles.snapIconWrap}>
                <Ionicons name="camera" size={28} color={colors.white} />
              </View>
              <View>
                <Text style={styles.snapTitle}>Snap a problem</Text>
                <Text style={styles.snapSubtitle}>Point your camera at any problem</Text>
              </View>
            </LinearGradient>
          </AnimatedPressable>

          {/* GALLERY — compact row card */}
          <AnimatedPressable
            onPress={() => pickImage("gallery")}
            disabled={extracting || problemQueue.length >= maxQueueSize}
            scaleDown={0.97}
            accessibilityRole="button"
            accessibilityLabel="Choose a photo from gallery"
          >
            <View style={[styles.compactCard, shadows.sm, extracting && styles.cardDisabled]}>
              <Ionicons name="images-outline" size={22} color={theme.primary} />
              <Text style={[styles.compactCardText, { color: theme.primary }]}>Choose from gallery</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </AnimatedPressable>

          {/* TYPE — always-visible inline input bar */}
          <View style={[styles.typeBar, { borderColor: typing ? theme.primary : colors.border }]}>
            <Ionicons name="create-outline" size={20} color={typing ? theme.primary : colors.textMuted} />
            <TextInput
              ref={inputRef}
              style={styles.typeBarInput}
              value={input}
              onChangeText={(t) => {
                setInput(t);
                if (error) setError(null);
              }}
              onFocus={() => {
                setTyping(true);
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
              }}
              onBlur={() => setTyping(false)}
              placeholder="Or type a problem…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={() => {
                if (input.trim()) handleAddToQueue();
              }}
              accessibilityLabel="Type a problem"
            />
            {input.trim() && (
              <TouchableOpacity
                onPress={() => {
                  handleAddToQueue();
                  inputRef.current?.blur();
                }}
                style={[styles.typeBarSend, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Add to queue"
              >
                <Ionicons name="add" size={18} color={colors.white} />
              </TouchableOpacity>
            )}
          </View>

          {/* Inline queue chips — tap to edit */}
          {problemQueue.length > 0 && (
            <View style={styles.queueChips}>
              <Text style={[styles.queueChipsLabel, { color: theme.primary }]}>{queueLabel}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.queueChipsRow}
              >
                {problemQueue.map((p, i) => (
                  <View
                    key={`${i}-${p}`}
                    style={[styles.queueChip, { backgroundColor: theme.primaryBg }]}
                  >
                    <TouchableOpacity
                      onPress={() => handleEditFromQueue(i)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit problem ${i + 1}`}
                      style={styles.queueChipTextWrap}
                    >
                      <Text
                        numberOfLines={1}
                        style={{ ...typography.label, color: theme.primary, fontSize: 13 }}
                      >
                        {truncateForChip(p)}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemoveFromQueue(i)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove problem ${i + 1}`}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Extracting indicator */}
          {extracting && (
            <View style={[styles.extractingCard, shadows.sm]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.extractingText}>
                {extractionProgress
                  ? `Reading ${progressDone} of ${extractionProgress.total}…`
                  : "Reading your problem…"}
              </Text>
            </View>
          )}

          {/* Quota confirm inline */}
          {quotaConfirm && (
            <View style={styles.quotaCard}>
              <Ionicons name="alert-circle" size={18} color={colors.warningDark} />
              <Text style={styles.quotaText}>
                This will use {collectProblems().length} of your {sessionsLeft} remaining problems today.
              </Text>
              <View style={styles.quotaButtons}>
                <TouchableOpacity onPress={() => setQuotaConfirm(false)} style={styles.quotaCancel}>
                  <Text style={styles.quotaCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSolve}
                  style={[styles.quotaConfirmBtn, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Continue and use remaining problems"
                >
                  <Text style={styles.quotaConfirmBtnText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Error */}
          {displayError && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{displayError}</Text>
              {lastSource && (
                <TouchableOpacity onPress={() => { setError(null); pickImage(lastSource); }}>
                  <Text style={styles.retryLink}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Quota footer */}
          {!isPro && sessionsLeft < Infinity && <QuotaFooter
            remaining={sessionsLeft}
            limit={dailySessionsLimit as number}
            themeColor={theme.primary}
          />}
        </ScrollView>

        {/* Sticky solve button — gradient reflects active subject */}
        <View style={styles.bottomBar}>
          <GradientButton
            onPress={handleSolve}
            label={solveLabel}
            loading={isLoading}
            disabled={totalProblems === 0}
            gradient={activeSubject.gradient}
            style={styles.solveButton}
          />
        </View>
      </KeyboardAvoidingView>

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
    </SafeAreaView>
  );
}

function QuotaFooter({
  remaining,
  limit,
  themeColor,
}: {
  remaining: number;
  limit: number;
  themeColor: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pct = limit > 0 ? (limit - remaining) / limit : 0;
  return (
    <View style={styles.quotaFooterRow}>
      <View style={styles.quotaBar}>
        <View
          style={[
            styles.quotaBarFill,
            { width: `${Math.min(pct * 100, 100)}%`, backgroundColor: themeColor },
            pct >= 1 && styles.quotaBarFillDanger,
            pct >= 0.8 && pct < 1 && styles.quotaBarFillWarning,
          ]}
        />
      </View>
      <Text style={styles.quotaFooterText}>{remaining} of {limit} left today</Text>
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // Mode segmented control
  modeContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  modeTrack: {
    flexDirection: "row",
    borderRadius: radii.pill,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  modeTabText: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
  },

  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Hero — slightly smaller so both learn/test fit on one line
  greetingTitle: {
    ...typography.title,
    fontSize: 22,
    color: colors.text,
    lineHeight: 28,
    marginBottom: spacing.lg,
  },
  coachmarkWrap: {
    marginBottom: spacing.md,
  },

  // Snap card — horizontal row with icon + text, larger to fill more page
  snapCard: {
    borderRadius: radii.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xxl + 4,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardDisabled: { opacity: 0.5 },
  snapIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  snapTitle: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 16,
  },
  snapSubtitle: {
    ...typography.caption,
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  // Compact row card (gallery)
  compactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  compactCardText: {
    ...typography.bodyBold,
    fontSize: 14,
    flex: 1,
  },

  // Always-visible type input bar
  typeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
    minHeight: 50,
  },
  typeBarInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "400",
    color: colors.text,
    paddingVertical: 0,
    height: 40,
    lineHeight: 20,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  typeBarSend: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    justifyContent: "center",
    alignItems: "center",
  },

  // Queue chips
  queueChips: {
    marginBottom: spacing.md,
  },
  queueChipsLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  queueChipsRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  queueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 220,
  },
  queueChipTextWrap: {
    flexShrink: 1,
  },

  // Extracting
  extractingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  extractingText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },

  // Quota confirm
  quotaCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warningDark,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  quotaText: {
    ...typography.body,
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  quotaButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  quotaCancel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  quotaCancelText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  quotaConfirmBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  quotaConfirmBtnText: {
    ...typography.label,
    color: colors.white,
  },

  // Error
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, ...typography.caption, flex: 1 },
  retryLink: { ...typography.label, color: colors.primary },

  // Quota footer
  quotaFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quotaBar: {
    flex: 1,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  quotaBarFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 2 },
  quotaBarFillWarning: { backgroundColor: colors.warningDark },
  quotaBarFillDanger: { backgroundColor: colors.error },
  quotaFooterText: { ...typography.caption, color: colors.textMuted },

  // Sticky bottom
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  solveButton: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
});
