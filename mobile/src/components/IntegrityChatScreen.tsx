import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { MathText } from "./MathText";
import {
  getIntegrityState,
  postIntegrityTurn,
  MIN_INTEGRITY_MESSAGE_CHARS,
  type IntegrityState,
} from "../services/api";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";
import { useTurnTelemetry } from "../utils/turnTelemetry";

const POLL_MS = 2500;

interface Props {
  submissionId: string;
  onExit: () => void;
}

/**
 * The integrity "explain your work" chat. After a student confirms their
 * OCR'd work, the agent asks a few follow-up questions about how they
 * solved a sampled problem; the student answers in chat until the agent
 * finishes. While the extraction pipeline is still preparing the check we
 * poll; once it's awaiting/in-progress we show the conversation. The
 * student never sees the disposition (pass vs flag look the same).
 */
export function IntegrityChatScreen({ submissionId, onExit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<IntegrityState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Optimistic echo of the student's just-sent message — shown immediately so
  // the chat reads student → thinking → reply (matching web), then cleared
  // once the server transcript (which includes it) comes back.
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const turnStart = useRef<number>(Date.now());
  const telemetry = useTurnTelemetry();
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPreparing = (s: IntegrityState) => s.overall_status === "extracting";

  // Poll only while the check is still preparing.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const s = await getIntegrityState(submissionId);
        if (!active) return;
        setState(s);
        setLoadError(false);
        turnStart.current = Date.now();
        if (isPreparing(s)) pollTimer.current = setTimeout(tick, POLL_MS);
      } catch {
        if (!active) return;
        setLoadError(true);
        pollTimer.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      active = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [submissionId]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (message.length < MIN_INTEGRITY_MESSAGE_CHARS || sending) return;
    setSending(true);
    setSendError(null);
    // Clear the composer + echo the message optimistically.
    setPending(message);
    setInput("");
    try {
      const seconds = Math.round((Date.now() - turnStart.current) / 1000);
      const next = await postIntegrityTurn(submissionId, message, seconds, telemetry.collect());
      setState(next);
      setPending(null);
      telemetry.reset();
      turnStart.current = Date.now();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Surface the failure and give the student their words back so a flaky
      // network doesn't silently swallow what they typed.
      setPending(null);
      setInput(message);
      setSendError("Couldn't send that — try again.");
      // The turn can 409 if the check finalized server-side (completed or
      // hit the turn cap). Refetch so the UI reflects that — e.g. flips to
      // "complete" and hides the composer — instead of silently failing.
      try {
        setState(await getIntegrityState(submissionId));
      } catch {
        /* keep current state; the error message already signaled the failure */
      }
    } finally {
      setSending(false);
    }
  }, [input, sending, submissionId, telemetry]);

  const trimmedLen = input.trim().length;
  const belowThreshold = trimmedLen > 0 && trimmedLen < MIN_INTEGRITY_MESSAGE_CHARS;

  // ── Pre-chat states ───────────────────────────────────
  if (loadError && !state) {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text style={styles.bodyText}>Couldn't load your check</Text>
        <Button label="Done" variant="secondary" onPress={onExit} />
      </Centered>
    );
  }
  if (!state || state.overall_status === "extracting") {
    return (
      <Centered styles={styles} colors={colors}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.doneTitle}>Preparing a few questions…</Text>
        <Text style={styles.bodyText}>This takes a few seconds.</Text>
        <Button label="I'll come back" variant="ghost" onPress={onExit} />
      </Centered>
    );
  }
  if (state.overall_status === "skipped_unreadable") {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="document-text-outline" size={44} color={colors.textMuted} />
        <Text style={styles.doneTitle}>No questions this time</Text>
        <Text style={styles.bodyText}>
          We couldn't read your work clearly, so your teacher will review it directly.
        </Text>
        <Button label="Done" onPress={onExit} />
      </Centered>
    );
  }
  if (state.overall_status === "no_check") {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="checkmark-circle" size={48} color={colors.success} />
        <Text style={styles.doneTitle}>All set</Text>
        <Button label="Done" onPress={onExit} />
      </Centered>
    );
  }

  const complete = state.overall_status === "complete";
  const problem = state.problems[0];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <AnimatedPressable onPress={onExit} style={styles.backButton}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>{complete ? "Done" : "Save & exit"}</Text>
          </AnimatedPressable>
          <Eyebrow style={styles.headerEyebrow}>Explain your work</Eyebrow>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {problem?.question ? (
            <View style={styles.problemCard}>
              <Text style={styles.problemNum}>Problem {problem.hw_position}</Text>
              <MathText
                text={problem.question}
                style={{ ...typography.body, fontSize: 14, color: colors.text }}
              />
            </View>
          ) : null}

          {state.transcript.map((t) => (
            <View
              key={t.ordinal}
              style={[styles.bubbleRow, t.role === "student" ? styles.rowStudent : styles.rowAgent]}
            >
              {t.role === "student" ? (
                <View style={styles.bubbleStudent}>
                  <Text style={styles.bubbleStudentText}>{t.content}</Text>
                </View>
              ) : (
                <View style={[styles.bubbleAgent, t.is_variant_probe && styles.bubbleVariant]}>
                  {t.is_variant_probe && (
                    <Text style={styles.variantTag}>Quick practice</Text>
                  )}
                  <MathText text={t.content} style={styles.bubbleAgentText} />
                </View>
              )}
            </View>
          ))}

          {pending && (
            <View style={[styles.bubbleRow, styles.rowStudent]}>
              <View style={styles.bubbleStudent}>
                <Text style={styles.bubbleStudentText}>{pending}</Text>
              </View>
            </View>
          )}

          {sending && (
            <View style={[styles.bubbleRow, styles.rowAgent]}>
              <View style={styles.bubbleAgent}>
                <Text style={styles.bubbleAgentText}>Thinking…</Text>
              </View>
            </View>
          )}

          {complete && (
            <View style={styles.completeBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.completeText}>
                Thanks for explaining your work! You're all done here.
              </Text>
            </View>
          )}
        </ScrollView>

        {!complete && (
          <View style={styles.inputBar}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={(t) => {
                  setInput(t);
                  if (sendError) setSendError(null);
                  telemetry.onTextChange(t);
                }}
                placeholder="Explain how you solved it…"
                placeholderTextColor={colors.textMuted}
                multiline
                editable={!sending}
              />
              <AnimatedPressable
                style={[
                  styles.sendButton,
                  (trimmedLen < MIN_INTEGRITY_MESSAGE_CHARS || sending) && styles.sendDisabled,
                ]}
                onPress={send}
                disabled={trimmedLen < MIN_INTEGRITY_MESSAGE_CHARS || sending}
                accessibilityLabel="Send"
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={colors.textOnPrimary} />
                )}
              </AnimatedPressable>
            </View>
            {sendError ? (
              <Text style={styles.sendErrorText}>{sendError}</Text>
            ) : belowThreshold ? (
              <Text style={styles.thresholdHint}>
                Add a little more — at least {MIN_INTEGRITY_MESSAGE_CHARS} characters.
              </Text>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Centered({
  children,
  styles,
  colors,
}: {
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centered}>{children}</View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    backButton: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.xs },
    backText: { ...typography.label, color: colors.primary, fontSize: 15 },
    headerEyebrow: { marginTop: spacing.xs },

    scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 6 },
    problemCard: {
      backgroundColor: colors.surfaceAlt2,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    problemNum: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },

    bubbleRow: { flexDirection: "row" },
    rowStudent: { justifyContent: "flex-end", paddingLeft: 60 },
    rowAgent: { justifyContent: "flex-start", paddingRight: 60 },
    bubbleStudent: {
      maxWidth: "85%",
      backgroundColor: colors.primary,
      borderRadius: 18,
      borderBottomRightRadius: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    bubbleStudentText: { ...typography.body, fontSize: 14, color: colors.textOnPrimary },
    bubbleAgent: {
      width: "85%",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    bubbleVariant: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
    variantTag: {
      ...typography.eyebrow,
      fontSize: 9,
      color: colors.primary,
      marginBottom: spacing.xs,
    },
    bubbleAgentText: { ...typography.body, fontSize: 14, color: colors.text },

    completeBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt2,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    completeText: { ...typography.body, fontSize: 14, color: colors.text, flex: 1 },

    inputBar: {
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    sendErrorText: { ...typography.caption, color: colors.error, fontSize: 12, paddingHorizontal: spacing.xs },
    thresholdHint: { ...typography.caption, color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.xs },
    input: {
      flex: 1,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      backgroundColor: colors.inputBg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...typography.body,
      fontSize: 15,
      color: colors.text,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },

    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xxxl,
      gap: spacing.md,
    },
    doneTitle: {
      ...typography.displaySerifItalic,
      fontSize: 24,
      lineHeight: 28,
      color: colors.text,
      marginTop: spacing.sm,
      textAlign: "center",
    },
    bodyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  });
