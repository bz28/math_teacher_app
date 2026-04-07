import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { PaywallScreen } from "./PaywallScreen";
import { UpgradePrompt } from "./UpgradePrompt";
import { RectangleSelector } from "./RectangleSelector";
import { useImageExtraction } from "../hooks/useImageExtraction";
import { useUpgradePrompt } from "../hooks/useUpgradePrompt";
import { useSessionStore } from "../stores/session";
import { useEntitlementStore } from "../stores/entitlements";
import { getUserName } from "../services/api";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

const MAX_PROBLEMS = 10;

const SUBJECT_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; gradient: keyof typeof gradients }> = {
  math: { label: "Math", icon: "calculator", gradient: "primary" },
  physics: { label: "Physics", icon: "rocket", gradient: "physics" },
  chemistry: { label: "Chemistry", icon: "flask", gradient: "chemistry" },
};

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
  onAccount,
  onHistory,
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [quotaConfirm, setQuotaConfirm] = useState(false);

  const problemQueue = useSessionStore((s) => s.problemQueue);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const problemImages = useSessionStore((s) => s.problemImages);
  const startSession = useSessionStore((s) => s.startSession);
  const startLearnQueue = useSessionStore((s) => s.startLearnQueue);
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
  const meta = SUBJECT_META[subject] ?? SUBJECT_META.math;

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

  const handleSubjectPress = () => {
    Alert.alert("Subject", "Pick a subject", [
      { text: "Math", onPress: () => onSubjectChange("math") },
      { text: "Physics", onPress: () => onSubjectChange("physics") },
      { text: "Chemistry", onPress: () => onSubjectChange("chemistry") },
      { text: "Cancel", style: "cancel" },
    ]);
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
    if (allProblems.length === 1) {
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
  const name = getUserName();

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

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Top bar — subject pill + account */}
        <View style={styles.topBar}>
          <AnimatedPressable
            style={styles.subjectPill}
            onPress={handleSubjectPress}
            scaleDown={0.96}
            accessibilityRole="button"
            accessibilityLabel={`Subject: ${meta.label}. Tap to change.`}
          >
            <LinearGradient
              colors={gradients[meta.gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.subjectPillInner}
            >
              <Ionicons name={meta.icon} size={16} color={colors.white} />
              <Text style={styles.subjectPillText}>{meta.label}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.white} />
            </LinearGradient>
          </AnimatedPressable>

          <View style={styles.topBarRight}>
            <TouchableOpacity
              onPress={onHistory}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="History"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="time-outline" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onAccount}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Account"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="person-circle-outline" size={28} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero greeting */}
          <View style={styles.greetingSection}>
            <Text style={styles.greeting}>{name ? `Hi ${name},` : "Hi there,"}</Text>
            <Text style={styles.greetingTitle}>What can I help you{"\n"}solve today?</Text>
          </View>

          {/* Big primary capture target */}
          <AnimatedPressable
            onPress={() => pickImage("camera")}
            disabled={extracting || problemQueue.length >= maxQueueSize}
            scaleDown={0.97}
            accessibilityRole="button"
            accessibilityLabel="Snap a photo of a problem"
          >
            <LinearGradient
              colors={gradients[meta.gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.snapCard, shadows.lg, extracting && styles.cardDisabled]}
            >
              <View style={styles.snapIconWrap}>
                <Ionicons name="camera" size={36} color={colors.white} />
              </View>
              <Text style={styles.snapTitle}>Snap a problem</Text>
              <Text style={styles.snapSubtitle}>Point your camera at any math problem</Text>
            </LinearGradient>
          </AnimatedPressable>

          {/* Secondary actions row */}
          <View style={styles.secondaryRow}>
            <AnimatedPressable
              style={[styles.secondaryCard, shadows.sm]}
              onPress={() => pickImage("gallery")}
              disabled={extracting || problemQueue.length >= maxQueueSize}
              scaleDown={0.96}
              accessibilityRole="button"
              accessibilityLabel="Choose photo from gallery"
            >
              <Ionicons name="images-outline" size={20} color={colors.primary} />
              <Text style={styles.secondaryLabel}>Gallery</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.secondaryCard, shadows.sm]}
              onPress={() => inputRef.current?.focus()}
              scaleDown={0.96}
              accessibilityRole="button"
              accessibilityLabel="Type a problem"
            >
              <Ionicons name="create-outline" size={20} color={colors.primary} />
              <Text style={styles.secondaryLabel}>Type it</Text>
            </AnimatedPressable>
          </View>

          {/* Inline text input */}
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={(t) => { setInput(t); setError(null); }}
              placeholder="…or type a problem here"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleAddToQueue}
              accessibilityLabel="Problem text input"
            />
            {input.trim() && problemQueue.length < maxQueueSize ? (
              <TouchableOpacity
                onPress={handleAddToQueue}
                style={styles.addChip}
                accessibilityRole="button"
                accessibilityLabel="Add to queue"
              >
                <Ionicons name="add" size={16} color={colors.white} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Inline queue chips */}
          {problemQueue.length > 0 && (
            <View style={styles.queueChips}>
              <Text style={styles.queueChipsLabel}>
                {problemQueue.length} queued
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.queueChipsRow}
              >
                {problemQueue.map((p, i) => (
                  <View key={`${i}-${p}`} style={styles.queueChip}>
                    <Text numberOfLines={1} style={styles.queueChipText}>{p}</Text>
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
                  ? `Reading ${extractionProgress.done + 1} of ${extractionProgress.total}…`
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
          {!isPro && sessionsRemaining() < Infinity && (() => {
            const remaining = sessionsRemaining();
            const limit = dailySessionsLimit as number;
            const pct = limit > 0 ? (limit - remaining) / limit : 0;
            return (
              <View style={styles.quotaFooterRow}>
                <View style={styles.quotaBar}>
                  <View style={[
                    styles.quotaBarFill,
                    { width: `${Math.min(pct * 100, 100)}%` },
                    pct >= 1 && styles.quotaBarFillDanger,
                    pct >= 0.8 && pct < 1 && styles.quotaBarFillWarning,
                  ]} />
                </View>
                <Text style={styles.quotaFooterText}>{remaining} of {limit} left today</Text>
              </View>
            );
          })()}
        </ScrollView>

        {/* Sticky solve button */}
        <View style={styles.bottomBar}>
          <GradientButton
            onPress={handleSolve}
            label={
              totalProblems === 0
                ? "Solve"
                : totalProblems === 1
                  ? "Solve"
                  : `Solve ${totalProblems} problems`
            }
            loading={isLoading}
            disabled={totalProblems === 0}
            gradient={meta.gradient}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  subjectPill: { borderRadius: radii.pill, overflow: "hidden" },
  subjectPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  subjectPillText: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: { padding: spacing.xs },

  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },

  greetingSection: { marginBottom: spacing.xl },
  greeting: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  greetingTitle: {
    ...typography.hero,
    color: colors.text,
    lineHeight: 36,
  },

  // Big snap card
  snapCard: {
    borderRadius: radii.xl,
    paddingVertical: spacing.xxxl + 4,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  cardDisabled: { opacity: 0.5 },
  snapIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  snapTitle: {
    ...typography.title,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  snapSubtitle: {
    ...typography.body,
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
  },

  // Secondary row
  secondaryRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  secondaryCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  secondaryLabel: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },

  // Input
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: spacing.lg,
  },
  addChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: spacing.sm,
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
    maxWidth: 200,
  },
  queueChipText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
    flexShrink: 1,
  },

  // Extracting
  extractingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: spacing.lg,
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
    borderRadius: radii.md,
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
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  solveButton: {
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
});
