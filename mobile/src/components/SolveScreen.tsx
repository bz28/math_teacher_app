import { useEffect, useRef, useState } from "react";
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
import { GradientButton } from "./GradientButton";
import { ExtractionModal } from "./ExtractionModal";
import { ImagePreview } from "./ImagePreview";
import { MockTestConfig } from "./MockTestConfig";
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { RectangleSelector } from "./RectangleSelector";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
import { MathText } from "./MathText";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

const MAX_PROBLEMS = 10;

type SubjectKey = "math" | "physics" | "chemistry";
type Mode = "learn" | "mock_test";

interface SubjectMeta {
  key: SubjectKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradient: keyof typeof gradients;
  primary: string;
  primaryBg: string;
}

const SUBJECTS: SubjectMeta[] = [
  { key: "math",      label: "Math",      icon: "calculator", gradient: "primary",   primary: "#6C5CE7", primaryBg: "#F0EDFF" },
  { key: "physics",   label: "Physics",   icon: "rocket",     gradient: "physics",   primary: "#0984E3", primaryBg: "#E3F2FD" },
  { key: "chemistry", label: "Chemistry", icon: "flask",      gradient: "chemistry", primary: "#00B894", primaryBg: "#E8F8F5" },
];

const MODES: { key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap; gradient: keyof typeof gradients }[] = [
  { key: "learn", label: "Learn", icon: "book-outline", gradient: "primary" },
  { key: "mock_test", label: "Mock Test", icon: "document-text-outline", gradient: "warning" },
];

interface Props {
  subject: string;
  onSubjectChange: (s: string) => void;
  onSessionStart: () => void;
  onSessionError: () => void;
  onAccount: () => void;
  onHistory: () => void;
}

export function SolveScreen({
  subject,
  onSubjectChange,
  onSessionStart,
  onSessionError,
}: Props) {
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

  const isPro = useEntitlementStore((s) => s.isPro);
  const sessionsRemaining = useEntitlementStore((s) => s.sessionsRemaining);
  const scansRemaining = useEntitlementStore((s) => s.scansRemaining);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => { setStoreSubject(subject); }, [subject, setStoreSubject]);

  const maxQueueSize = isPro ? MAX_PROBLEMS : Math.min(MAX_PROBLEMS, sessionsRemaining());
  const activeSubject = SUBJECTS.find((s) => s.key === subject) ?? SUBJECTS[0];

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
    isPro ? undefined : scansRemaining,
    isPro ? undefined : () => showUpgrade("image_scan", "Scan Limit Reached", `You've used all ${dailyScansLimit} image scans for today. Upgrade to Pro for unlimited scans.`),
  );

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

    if (!isPro && sessionsRemaining() <= 0) {
      showUpgrade("create_session", "Daily Limit Reached", `You've used all ${dailySessionsLimit} problems for today. Upgrade to Pro for unlimited access.`);
      return;
    }

    if (!isPro && allProblems.length > 1 && !quotaConfirm) {
      setQuotaConfirm(true);
      return;
    }
    setQuotaConfirm(false);

    onSessionStart();

    if (mode === "mock_test") {
      const generateCount = examType === "generate_similar" ? allProblems.length : 0;
      const timeLimit = untimed ? null : timeLimitMinutes;
      await startMockTest(allProblems, generateCount, timeLimit, multipleChoice);
    } else if (allProblems.length === 1) {
      await startSession(allProblems[0], "learn");
    } else {
      await startLearnQueue(allProblems);
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
        maxRectangles={Math.min(10, maxQueueSize - problemQueue.length, scansRemaining())}
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
        return `${n} seed${n !== 1 ? "s" : ""} → ${n} generated question${n !== 1 ? "s" : ""}`;
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

  // Subject-aware accent colors that flow through the whole screen
  const theme = { primary: activeSubject.primary, primaryBg: activeSubject.primaryBg };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Subject pill row — OUTSIDE KeyboardAvoidingView so it never reflows */}
      <View style={styles.subjectRowOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subjectRow}
        >
          {SUBJECTS.map((s) => {
            const isActive = s.key === subject;
            return (
              <AnimatedPressable
                key={s.key}
                onPress={() => onSubjectChange(s.key)}
                scaleDown={0.95}
                accessibilityRole="button"
                accessibilityLabel={`${s.label}${isActive ? ", selected" : ""}`}
                accessibilityState={{ selected: isActive }}
              >
                {isActive ? (
                  <LinearGradient
                    colors={gradients[s.gradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.subjectPill}
                  >
                    <Ionicons name={s.icon} size={16} color={colors.white} />
                    <Text style={styles.subjectPillText}>{s.label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.subjectPill, styles.subjectPillInactive]}>
                    <Ionicons name={s.icon} size={16} color={colors.textSecondary} />
                    <Text style={[styles.subjectPillText, styles.subjectPillTextInactive]}>{s.label}</Text>
                  </View>
                )}
              </AnimatedPressable>
            );
          })}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        {/* Mode segmented control */}
        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const isActive = m.key === mode;
            return (
              <TouchableOpacity
                key={m.key}
                onPress={() => setMode(m.key)}
                style={[
                  styles.modePill,
                  isActive && { backgroundColor: theme.primaryBg, borderWidth: 1, borderColor: theme.primary },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${m.label} mode${isActive ? ", selected" : ""}`}
                accessibilityState={{ selected: isActive }}
              >
                <Ionicons
                  name={m.icon}
                  size={14}
                  color={isActive ? theme.primary : colors.textMuted}
                />
                <Text style={[styles.modePillText, isActive && { color: theme.primary }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.greetingTitle}>What can I help you solve?</Text>

          {/* SNAP — full-width gradient hero card */}
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
              style={[styles.bigCard, shadows.lg, extracting && styles.cardDisabled]}
            >
              <View style={styles.bigCardIconWrap}>
                <Ionicons name="camera" size={32} color={colors.white} />
              </View>
              <Text style={styles.bigCardTitle}>Snap a problem</Text>
              <Text style={styles.bigCardSubtitle}>Point your camera at any problem</Text>
            </LinearGradient>
          </AnimatedPressable>

          {/* GALLERY — full-width outlined card, equal size to Snap */}
          <AnimatedPressable
            onPress={() => pickImage("gallery")}
            disabled={extracting || problemQueue.length >= maxQueueSize}
            scaleDown={0.97}
            accessibilityRole="button"
            accessibilityLabel="Choose a photo from gallery"
          >
            <View
              style={[
                styles.bigCard,
                styles.bigCardOutlined,
                shadows.sm,
                extracting && styles.cardDisabled,
                { borderColor: theme.primary },
              ]}
            >
              <View style={[styles.bigCardIconWrap, { backgroundColor: theme.primaryBg }]}>
                <Ionicons name="images" size={32} color={theme.primary} />
              </View>
              <Text style={[styles.bigCardTitle, { color: theme.primary }]}>Choose a photo</Text>
              <Text style={[styles.bigCardSubtitle, { color: colors.textSecondary }]}>
                Pick a problem from your gallery
              </Text>
            </View>
          </AnimatedPressable>

          {/* TYPE — full-width card matching Snap/Gallery */}
          <AnimatedPressable
            onPress={() => {
              setTyping(true);
              setTimeout(() => {
                inputRef.current?.focus();
                scrollRef.current?.scrollToEnd({ animated: true });
              }, 80);
            }}
            disabled={typing}
            scaleDown={0.97}
            accessibilityRole="button"
            accessibilityLabel="Type a problem"
          >
            <View
              style={[
                styles.bigCard,
                styles.bigCardOutlined,
                shadows.sm,
                { borderColor: theme.primary },
              ]}
            >
              <View style={[styles.bigCardIconWrap, { backgroundColor: theme.primaryBg }]}>
                <Ionicons name="create" size={32} color={theme.primary} />
              </View>
              {typing ? (
                <View style={styles.typeInputRow}>
                  <TextInput
                    ref={inputRef}
                    style={[styles.typeInput, { color: theme.primary }]}
                    value={input}
                    onChangeText={(t) => { setInput(t); setError(null); }}
                    placeholder="Type your problem here…"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => {
                      handleAddToQueue();
                      inputRef.current?.blur();
                      setTyping(false);
                    }}
                    onBlur={() => {
                      if (!input.trim()) setTyping(false);
                    }}
                    accessibilityLabel="Problem text input"
                  />
                  {input.trim() ? (
                    <TouchableOpacity
                      onPress={() => {
                        handleAddToQueue();
                        inputRef.current?.blur();
                        setTyping(false);
                      }}
                      style={[styles.addChip, { backgroundColor: theme.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel="Add to queue"
                    >
                      <Ionicons name="checkmark" size={20} color={colors.white} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <>
                  <Text style={[styles.bigCardTitle, { color: theme.primary }]}>Type a problem</Text>
                  <Text style={[styles.bigCardSubtitle, { color: colors.textSecondary }]}>
                    Tap to enter your problem here
                  </Text>
                </>
              )}
            </View>
          </AnimatedPressable>

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
                      <MathText
                        text={p}
                        style={{ ...typography.label, color: theme.primary, fontSize: 13 }}
                        numberOfLines={1}
                      />
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

          {/* Mock Test config (matches main InputScreen behavior) */}
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
            />
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
                This will use {collectProblems().length} of your {sessionsRemaining()} remaining problems today.
              </Text>
              <View style={styles.quotaButtons}>
                <TouchableOpacity onPress={() => setQuotaConfirm(false)} style={styles.quotaCancel}>
                  <Text style={styles.quotaCancelText}>Cancel</Text>
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
          {!isPro && sessionsRemaining() < Infinity && <QuotaFooter
            remaining={sessionsRemaining()}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // Subject pill row
  subjectRowOuter: {
    backgroundColor: colors.background,
  },
  subjectRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  subjectPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.pill,
  },
  subjectPillInactive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subjectPillText: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },
  subjectPillTextInactive: {
    color: colors.textSecondary,
  },

  // Mode segmented control
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.inputBg,
  },
  modePillActive: {
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  modePillText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textMuted,
  },
  modePillTextActive: {
    color: colors.primary,
  },

  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Hero
  greetingTitle: {
    ...typography.hero,
    color: colors.text,
    lineHeight: 38,
    marginBottom: spacing.xl,
  },

  // Big equal-size cards (snap, gallery, type)
  bigCard: {
    borderRadius: radii.lg,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.md,
    minHeight: 180,
    justifyContent: "center",
  },
  bigCardOutlined: {
    backgroundColor: colors.white,
    borderWidth: 2,
  },
  cardDisabled: { opacity: 0.5 },
  bigCardIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  bigCardTitle: {
    ...typography.title,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  bigCardSubtitle: {
    ...typography.caption,
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
  },

  // Type input row — appears inside the type card when in editing state
  typeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  typeInput: {
    flex: 1,
    ...typography.bodyBold,
    fontSize: 16,
    color: colors.text,
    paddingVertical: spacing.sm,
    textAlign: "center",
  },
  addChip: {
    width: 40,
    height: 40,
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
    color: colors.primary,
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
  queueChipText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
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
  },
  quotaCancel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  quotaCancelText: {
    ...typography.label,
    color: colors.textSecondary,
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
