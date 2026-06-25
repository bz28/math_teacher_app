import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { MathText } from "./MathText";
import {
  confirmExtraction,
  flagExtraction,
  getSubmission,
  type SubmissionState,
} from "../services/api";
import { confidenceBand, groupExtraction } from "../utils/extraction";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

const POLL_MS = 2500;

interface Props {
  assignmentId: string;
  onDone: () => void;
  /** After confirming when integrity is enabled, open the explain-your-work chat. */
  onIntegrityCheck: (submissionId: string) => void;
}

/**
 * Post-submit step. Polls the submission until the OCR extraction is ready,
 * then asks the student to confirm what the reader pulled from their work
 * (so grading/integrity can run on accurate text) or flag it as wrong (which
 * routes the submission to manual teacher grading). If the assignment has
 * neither integrity nor AI grading, there's nothing to confirm — we just
 * acknowledge the submission.
 */
export function ExtractionConfirmScreen({ assignmentId, onDone, onIntegrityCheck }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<SubmissionState | null>(null);
  const [error, setError] = useState(false);
  const [acting, setActing] = useState(false);
  // Sparse OCR corrections, keyed "{position}:{step_num}" / "{position}:final".
  // Only touched fields land here; sent to confirm-extraction.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needsExtraction = (s: SubmissionState) => s.integrity_check_enabled || s.ai_grading_enabled;
  const settled = (s: SubmissionState) =>
    !needsExtraction(s) ||
    s.extraction != null ||
    s.extraction_confirmed_at != null ||
    s.extraction_flagged_at != null;

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const s = await getSubmission(assignmentId);
        if (!active) return;
        setState(s);
        setError(false);
        if (!settled(s)) timer.current = setTimeout(tick, POLL_MS);
      } catch {
        if (!active) return;
        setError(true);
        // Transient blip — keep polling so the screen recovers on its own
        // rather than stalling on the spinner until the user re-enters.
        timer.current = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const doConfirm = useCallback(async () => {
    if (!state || acting) return;
    setActing(true);
    try {
      await confirmExtraction(state.submission_id, edits);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Confirming kicks off grading + (if enabled) the integrity check.
      if (state.integrity_check_enabled) onIntegrityCheck(state.submission_id);
      else onDone();
    } catch {
      setActing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [state, acting, edits, onDone, onIntegrityCheck]);

  const doFlag = useCallback(async () => {
    if (!state || acting) return;
    setActing(true);
    try {
      await flagExtraction(state.submission_id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch {
      setActing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [state, acting, onDone]);

  // ── States ────────────────────────────────────────────
  if (error && !state) {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
        <Text style={styles.bodyText}>Couldn't load your submission</Text>
        <Button label="Done" variant="secondary" onPress={onDone} />
      </Centered>
    );
  }

  if (!state) {
    return (
      <Centered styles={styles} colors={colors}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.bodyText}>Loading…</Text>
      </Centered>
    );
  }

  // Already resolved, or nothing to confirm → acknowledge.
  if (!needsExtraction(state) || state.extraction_confirmed_at || state.extraction_flagged_at) {
    return (
      <Centered styles={styles} colors={colors}>
        <Ionicons name="checkmark-circle" size={48} color={colors.success} />
        <Text style={styles.doneTitle}>Submitted!</Text>
        <Text style={styles.bodyText}>
          {state.extraction_flagged_at
            ? "Your teacher will grade this by hand."
            : "You're all set — check back for your grade."}
        </Text>
        <Button label="Done" onPress={onDone} />
      </Centered>
    );
  }

  // Extraction still running. Offer an exit — it keeps processing server-side,
  // so the student isn't trapped if it's slow; they can confirm later.
  if (state.extraction == null) {
    return (
      <Centered styles={styles} colors={colors}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.doneTitle}>Reading your work…</Text>
        <Text style={styles.bodyText}>This takes a few seconds. Hang tight.</Text>
        <Button label="I'll check back later" variant="ghost" onPress={onDone} />
      </Centered>
    );
  }

  // Extraction ready → confirm or flag.
  const band = confidenceBand(state.extraction.confidence);
  const groups = groupExtraction(state.extraction);
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Eyebrow style={styles.eyebrow}>Check your work</Eyebrow>
        <Text style={styles.title}>Did we read this right?</Text>
        <Text style={styles.subtitle}>
          Here's what we pulled from your photos. Fix anything we misread, then confirm so we grade it accurately.
        </Text>
        {band !== "high" && (
          <View style={styles.confidenceBadge}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.warningDark} />
            <Text style={styles.confidenceText}>
              {band === "low" ? "Some parts were hard to read" : "Double-check the parts below"}
            </Text>
          </View>
        )}

        {groups.length === 0 ? (
          <View style={styles.problem}>
            <Text style={styles.emptyStep}>We couldn't read any work from your photos.</Text>
          </View>
        ) : (
          groups.map((g) => {
            // The backend keys edits by problem_position, so only positioned
            // groups are editable; unattributed "Other work" stays read-only.
            const editable = g.position != null;
            return (
              <View key={g.position ?? "other"} style={styles.problem}>
                <Text style={styles.problemNum}>
                  {g.position == null ? "Other work" : `Problem ${g.position}`}
                </Text>
                {g.steps.map((s, i) => {
                  const original = s.plain_english || s.latex;
                  if (!editable) {
                    return (
                      <MathText
                        key={`${s.step_num}-${i}`}
                        text={original}
                        style={{ ...typography.body, fontSize: 14, color: colors.text }}
                      />
                    );
                  }
                  const key = `${g.position}:${s.step_num}`;
                  return (
                    <TextInput
                      key={`${s.step_num}-${i}`}
                      style={styles.editField}
                      value={edits[key] ?? original}
                      onChangeText={(t) => setEdits((e) => ({ ...e, [key]: t }))}
                      multiline
                      placeholder="(blank to remove this line)"
                      placeholderTextColor={colors.textMuted}
                    />
                  );
                })}
                {g.finalAnswer && editable ? (
                  <View style={styles.answerRow}>
                    <Text style={styles.answerLabel}>Answer</Text>
                    <TextInput
                      style={[styles.editField, styles.answerField]}
                      value={edits[`${g.position}:final`] ?? (g.finalAnswer.answer_plain || g.finalAnswer.answer_latex)}
                      onChangeText={(t) => setEdits((e) => ({ ...e, [`${g.position}:final`]: t }))}
                      placeholder="(blank to remove)"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ) : g.finalAnswer && (g.finalAnswer.answer_plain || g.finalAnswer.answer_latex) ? (
                  <Text style={styles.answer}>
                    Answer: {g.finalAnswer.answer_plain || g.finalAnswer.answer_latex}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}

        <View style={styles.actions}>
          <Button label="Looks right" onPress={doConfirm} loading={acting} />
          <Button
            label="The reader got it wrong"
            variant="secondary"
            onPress={doFlag}
            disabled={acting}
          />
        </View>
        <Text style={styles.flagHint}>
          If it's wrong, your teacher will grade your original photos by hand instead.
        </Text>
      </ScrollView>
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

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
  eyebrow: {},
  title: { ...typography.displaySerifItalic, fontSize: 26, lineHeight: 32, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  confidenceText: { ...typography.caption, color: colors.warningDark, fontSize: 13 },
  problem: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  problemNum: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },
  emptyStep: { ...typography.body, color: colors.textMuted, fontSize: 14, fontStyle: "italic" },
  answer: { ...typography.bodyBold, fontSize: 14, color: colors.text, marginTop: spacing.xs },
  editField: {
    ...typography.body,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  answerRow: { gap: spacing.xs, marginTop: spacing.xs },
  answerLabel: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },
  answerField: { ...typography.bodyBold },
  actions: { gap: spacing.md, marginTop: spacing.lg },
  flagHint: { ...typography.caption, color: colors.textMuted, fontSize: 12, textAlign: "center" },

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
  },
  bodyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
});
