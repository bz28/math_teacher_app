import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { groupExtraction } from "../utils/extraction";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";
import { useReducedMotion } from "../utils/useReducedMotion";
import { useTurnTelemetry } from "../utils/turnTelemetry";

const POLL_MS = 2500;
// Give up on the "Preparing…" wait after this long and offer a retry rather
// than spinning forever on a stalled pipeline. Mirrors web's pending-view
// TIMEOUT_MS (90s) — the pipeline is 20–60s of real LLM work.
const PREPARE_TIMEOUT_MS = 90_000;
// After this long with no typing/sending, surface a calm "take your time"
// nudge + an "I need more time" affordance. Never cuts the student off —
// server-side turn caps are independent. Mirrors web's mobile window.
const INACTIVITY_NUDGE_MS = 180_000;
const INACTIVITY_TICK_MS = 5_000;
// Soft time budget advertised in the header. Mobile typing is slower than
// desktop, so we set expectations a touch longer (matches web's mobile
// budget). It's an "about this long" hint, never a cutoff.
const BUDGET_LABEL = "~5 min";
// The truthful "I can't explain this" — sent by the stuck chip, bypassing
// the min-char gate so honesty is always one tap, never coached into a
// fabricated answer by a character minimum.
const STUCK_MESSAGE = "I'm stuck — not sure how to explain this.";

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
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<IntegrityState | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Elapsed sense + give-up fallback for the "Preparing…" wait. `prepareTimedOut`
  // flips once we cross PREPARE_TIMEOUT_MS still stuck; retry re-arms the poll.
  const [prepareElapsedMs, setPrepareElapsedMs] = useState(0);
  const [prepareTimedOut, setPrepareTimedOut] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Optimistic echo of the student's just-sent message — shown immediately so
  // the chat reads student → thinking → reply (matching web), then cleared
  // once the server transcript (which includes it) comes back.
  const [pending, setPending] = useState<string | null>(null);
  // Collapsible reference: the student's own extracted work, hidden by default
  // so the chat stays focused, expandable when the agent asks about a step.
  const [referenceOpen, setReferenceOpen] = useState(false);
  // Inactivity nudge + extended-window state.
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [timeoutExtended, setTimeoutExtended] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const turnStart = useRef<number>(Date.now());
  const lastActivity = useRef<number>(Date.now());
  const telemetry = useTurnTelemetry();
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPreparing = (s: IntegrityState) => s.overall_status === "extracting";
  const complete = state?.overall_status === "complete";

  // Poll only while the check is still preparing. Tracks elapsed time and
  // gives up after PREPARE_TIMEOUT_MS so a stalled pipeline never spins
  // forever. `pollNonce` lets the retry button re-arm the whole loop.
  useEffect(() => {
    let active = true;
    const startedAt = Date.now();
    setPrepareTimedOut(false);
    setPrepareElapsedMs(0);
    const tick = async () => {
      const stalled = Date.now() - startedAt >= PREPARE_TIMEOUT_MS;
      try {
        const s = await getIntegrityState(submissionId);
        if (!active) return;
        setState(s);
        setLoadError(false);
        turnStart.current = Date.now();
        lastActivity.current = Date.now();
        if (isPreparing(s)) {
          if (stalled) {
            setPrepareTimedOut(true);
            return;
          }
          setPrepareElapsedMs(Date.now() - startedAt);
          pollTimer.current = setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!active) return;
        setLoadError(true);
        if (stalled) {
          setPrepareTimedOut(true);
          return;
        }
        setPrepareElapsedMs(Date.now() - startedAt);
        pollTimer.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      active = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [submissionId, pollNonce]);

  // Inactivity nudge: if the student goes quiet, show a calm "take your time"
  // banner + "I need more time". Any activity resets the timer. Stops once
  // they've tapped "I need more time" (we trust them, no more nudges) or the
  // chat is complete. Never finalizes anything — server turn caps are separate.
  const nudgeTimeoutMs = INACTIVITY_NUDGE_MS * (timeoutExtended ? 2 : 1);
  useEffect(() => {
    if (complete || timeoutExtended) return;
    const id = setInterval(() => {
      if (sending) return;
      if (Date.now() - lastActivity.current >= nudgeTimeoutMs) setNudgeVisible(true);
    }, INACTIVITY_TICK_MS);
    return () => clearInterval(id);
  }, [complete, sending, nudgeTimeoutMs, timeoutExtended]);

  const markActivity = useCallback(() => {
    lastActivity.current = Date.now();
    setNudgeVisible((v) => (v ? false : v));
  }, []);

  const handleNeedMoreTime = useCallback(() => {
    setTimeoutExtended(true);
    telemetry.markNeedMoreTime();
    markActivity();
    Haptics.selectionAsync();
  }, [telemetry, markActivity]);

  const send = useCallback(
    async (override?: string) => {
      // `override` (the "I'm stuck" chip) bypasses the min-char gate so the
      // truthful "I can't explain" is always sendable, never blocked.
      const message = (override ?? input).trim();
      if (sending || !message) return;
      if (override == null && message.length < MIN_INTEGRITY_MESSAGE_CHARS) return;
      setSending(true);
      setSendError(null);
      markActivity();
      // Clear the composer + echo the message optimistically.
      setPending(message);
      if (override == null) setInput("");
      try {
        const seconds = Math.round((Date.now() - turnStart.current) / 1000);
        const next = await postIntegrityTurn(submissionId, message, seconds, telemetry.collect());
        setState(next);
        setPending(null);
        telemetry.reset();
        turnStart.current = Date.now();
        lastActivity.current = Date.now();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        // Surface the failure and give the student their words back so a flaky
        // network doesn't silently swallow what they typed.
        setPending(null);
        if (override == null) setInput(message);
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
    },
    [input, sending, submissionId, telemetry, markActivity],
  );

  const trimmedLen = input.trim().length;
  const belowThreshold = trimmedLen > 0 && trimmedLen < MIN_INTEGRITY_MESSAGE_CHARS;

  // ── Pre-chat states ───────────────────────────────────
  // Timeout fallback takes precedence: a stalled "Preparing…" wait gets a
  // give-up/retry screen instead of an endless spinner.
  if (prepareTimedOut && (!state || state.overall_status === "extracting")) {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="time-outline" size={40} color={colors.textMuted} />
        <Text style={styles.doneTitle}>This is taking longer than usual</Text>
        <Text style={styles.bodyText}>
          Your work is saved. You can try again now or come back in a bit.
        </Text>
        <Button
          label="Try again"
          onPress={() => {
            setLoadError(false);
            setPollNonce((n) => n + 1);
          }}
        />
        <Button label="I'll come back later" variant="ghost" onPress={onExit} />
      </Centered>
    );
  }
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
    const seconds = Math.floor(prepareElapsedMs / 1000);
    return (
      <Centered styles={styles} colors={colors}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.doneTitle}>Preparing a few questions…</Text>
        <Text style={styles.bodyText}>
          This usually takes about 20 seconds.
          {seconds >= 10 ? ` (${seconds}s)` : ""}
        </Text>
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

  const problem = state.problems[0];
  // Progress: how many sampled problems the agent has verdicted. Mobile
  // usually samples one, so the count only reads naturally when there's
  // more than one — otherwise the thin bar carries the sense of motion.
  const totalProblems = state.problems.length;
  const problemsVerdicted = state.problems.filter(
    (p) => p.status === "verdict_submitted" || p.status === "dismissed",
  ).length;
  const progressPct = totalProblems > 0 ? (problemsVerdicted / totalProblems) * 100 : 0;
  // The student's own extracted work, surfaced as a reference so a kid asked
  // "walk me through step 3" can actually see step 3. Now typed as Extraction
  // straight off the integrity payload (IntegrityStateResponse.extraction).
  const extraction = state.extraction ?? null;
  const extractionGroups =
    extraction && Array.isArray(extraction.steps)
      ? groupExtraction({
          steps: extraction.steps,
          // Normalize a possibly-partial wire shape — final_answers/confidence
          // may be absent on the loose Record payload, and groupExtraction
          // iterates final_answers unconditionally.
          final_answers: Array.isArray(extraction.final_answers) ? extraction.final_answers : [],
          confidence: typeof extraction.confidence === "number" ? extraction.confidence : 0,
        })
      : [];
  const hasReference = extractionGroups.length > 0;

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
          <View style={styles.headerTitleRow}>
            <Eyebrow style={styles.headerEyebrow}>Explain your work</Eyebrow>
            {!complete && (
              <Text style={styles.headerMeta}>
                A few questions · {BUDGET_LABEL}
                {totalProblems > 1 ? ` · ${problemsVerdicted} of ${totalProblems}` : ""}
              </Text>
            )}
          </View>
        </View>
        {totalProblems > 0 && !complete && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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

          {/* Collapsible reference: the student's own extracted work, so a kid
              asked about "step 3" can actually look at step 3. */}
          {hasReference && (
            <View style={styles.referenceWrap}>
              <AnimatedPressable
                onPress={() => setReferenceOpen((v) => !v)}
                style={styles.referenceToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: referenceOpen }}
                accessibilityLabel={referenceOpen ? "Hide your work" : "Show your work"}
              >
                <Ionicons
                  name={referenceOpen ? "chevron-down" : "chevron-forward"}
                  size={14}
                  color={colors.textSecondary}
                />
                <Text style={styles.referenceToggleText}>
                  {referenceOpen ? "Hide your work" : "Your work (as we read it)"}
                </Text>
              </AnimatedPressable>
              {referenceOpen && (
                <View style={styles.referenceBody}>
                  {extractionGroups.map((g) => (
                    <View key={g.position ?? "other"} style={styles.referenceGroup}>
                      <Text style={styles.problemNum}>
                        {g.position == null ? "Other work" : `Problem ${g.position}`}
                      </Text>
                      {g.steps.map((s, i) => (
                        <MathText
                          key={`${s.step_num}-${i}`}
                          text={s.plain_english || s.latex}
                          style={{ ...typography.body, fontSize: 13, color: colors.text }}
                        />
                      ))}
                      {g.finalAnswer && (g.finalAnswer.answer_plain || g.finalAnswer.answer_latex) ? (
                        <Text style={styles.referenceAnswer}>
                          Answer: {g.finalAnswer.answer_plain || g.finalAnswer.answer_latex}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Supportive "why am I here" intro — shown above the conversation
              while the chat is active so an honest, anxious student knows this
              is routine and non-punitive, not an accusation. */}
          {!complete && (
            <View style={styles.introCard}>
              <Text style={styles.introTitle}>Just talk me through your thinking</Text>
              <Text style={styles.introBody}>
                Your teacher uses a quick chat to hear how you worked through a problem, in your own
                words. No trick questions, nothing to look up — just explain your thinking.
              </Text>
            </View>
          )}

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
                <ThinkingIndicator colors={colors} reduced={reducedMotion} styles={styles} />
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
            {nudgeVisible && !timeoutExtended && (
              <View style={styles.nudge}>
                <Text style={styles.nudgeText}>Still there? Take your time.</Text>
                <AnimatedPressable
                  onPress={handleNeedMoreTime}
                  style={styles.nudgeButton}
                  accessibilityLabel="I need more time"
                >
                  <Text style={styles.nudgeButtonText}>I need more time</Text>
                </AnimatedPressable>
              </View>
            )}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={(t) => {
                  setInput(t);
                  if (sendError) setSendError(null);
                  telemetry.onTextChange(t);
                  markActivity();
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
                onPress={() => send()}
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
            {/* Low-emphasis honest-out: a truthful "I can't explain this" must
                be one tap, never gated by the character minimum. */}
            <AnimatedPressable
              onPress={() => send(STUCK_MESSAGE)}
              disabled={sending}
              style={styles.stuckChip}
              accessibilityRole="button"
              accessibilityLabel="I'm stuck — not sure how to explain this"
            >
              <Ionicons name="help-circle-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.stuckChipText}>I'm stuck — not sure how to explain this</Text>
            </AnimatedPressable>
            {sendError ? (
              <Text style={styles.sendErrorText}>{sendError}</Text>
            ) : belowThreshold ? (
              <Text style={styles.thresholdHint}>
                Add a little more — at least {MIN_INTEGRITY_MESSAGE_CHARS} characters. Stuck? Tap
                the line above.
              </Text>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Animated "thinking" indicator — three dots that pulse in sequence while we
 * wait on the agent. Respects reduced-motion: when on, the dots render static
 * (no looping animation). The "Thinking…" label stays in both modes.
 */
function ThinkingIndicator({
  colors,
  reduced,
  styles,
}: {
  colors: ColorPalette;
  reduced: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const d0 = useRef(new Animated.Value(0.3)).current;
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (reduced) return;
    const dots = [d0, d1, d2];
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 400, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, d0, d1, d2]);

  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDots}>
        {[d0, d1, d2].map((d, i) => (
          <Animated.View key={i} style={[styles.thinkingDot, { opacity: reduced ? 0.5 : d }]} />
        ))}
      </View>
      <Text style={styles.thinkingText}>Thinking…</Text>
    </View>
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
    headerTitleRow: {
      marginTop: spacing.xs,
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    headerEyebrow: {},
    headerMeta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
    progressTrack: {
      height: 2,
      backgroundColor: colors.borderLight,
      marginHorizontal: spacing.lg,
      borderRadius: 1,
      overflow: "hidden",
    },
    progressFill: { height: 2, backgroundColor: colors.primary, borderRadius: 1 },

    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: 6,
    },
    problemCard: {
      backgroundColor: colors.surfaceAlt2,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    problemNum: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },

    referenceWrap: { marginBottom: spacing.sm },
    referenceToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    referenceToggleText: { ...typography.label, fontSize: 12, color: colors.textSecondary },
    referenceBody: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    referenceGroup: { gap: spacing.xs },
    referenceAnswer: { ...typography.bodyBold, fontSize: 13, color: colors.text, marginTop: 2 },

    introCard: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    introTitle: {
      ...typography.serifSubhead,
      fontSize: 18,
      lineHeight: 22,
      color: colors.text,
    },
    introBody: { ...typography.body, fontSize: 13, lineHeight: 20, color: colors.textSecondary },

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

    thinkingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    thinkingDots: { flexDirection: "row", alignItems: "center", gap: 4 },
    thinkingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
    thinkingText: { ...typography.body, fontSize: 14, color: colors.textMuted, fontStyle: "italic" },

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
    nudge: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt2,
      borderRadius: radii.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.xs,
    },
    nudgeText: { ...typography.body, fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
    nudgeButton: {
      backgroundColor: colors.primaryBg,
      borderRadius: radii.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    nudgeButtonText: { ...typography.label, fontSize: 12, color: colors.primary },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    stuckChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      alignSelf: "flex-start",
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    stuckChipText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
    sendErrorText: {
      ...typography.caption,
      color: colors.error,
      fontSize: 12,
      paddingHorizontal: spacing.xs,
    },
    thresholdHint: {
      ...typography.caption,
      color: colors.textMuted,
      fontSize: 12,
      paddingHorizontal: spacing.xs,
    },
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
