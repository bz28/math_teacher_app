import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

const POLL_MS = 2500;

interface Props {
  assignmentId: string;
  onDone: () => void;
}

/**
 * Post-submit step. Polls the submission until the OCR extraction is ready,
 * then asks the student to confirm what the reader pulled from their work
 * (so grading/integrity can run on accurate text) or flag it as wrong (which
 * routes the submission to manual teacher grading). If the assignment has
 * neither integrity nor AI grading, there's nothing to confirm — we just
 * acknowledge the submission.
 */
export function ExtractionConfirmScreen({ assignmentId, onDone }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<SubmissionState | null>(null);
  const [error, setError] = useState(false);
  const [acting, setActing] = useState(false);
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
        if (active) setError(true);
      }
    };
    tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const act = useCallback(
    async (fn: (id: string) => Promise<unknown>) => {
      if (!state || acting) return;
      setActing(true);
      try {
        await fn(state.submission_id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone();
      } catch {
        setActing(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [state, acting, onDone],
  );

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
  const conf = state.extraction.overall_confidence;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Eyebrow style={styles.eyebrow}>Check your work</Eyebrow>
        <Text style={styles.title}>Did we read this right?</Text>
        <Text style={styles.subtitle}>
          Here's what we pulled from your photos. Confirm it's right so we can grade it accurately.
        </Text>
        {conf !== "high" && (
          <View style={styles.confidenceBadge}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.warningDark} />
            <Text style={styles.confidenceText}>
              {conf === "low" ? "Some parts were hard to read" : "Double-check the parts below"}
            </Text>
          </View>
        )}

        {state.extraction.problems.map((p) => (
          <View key={p.position} style={styles.problem}>
            <Text style={styles.problemNum}>Problem {p.position}</Text>
            {p.student_steps.length === 0 && p.student_answer == null ? (
              <Text style={styles.emptyStep}>No work read for this problem.</Text>
            ) : (
              <>
                {p.student_steps.map((s, i) => (
                  <MathText
                    key={i}
                    text={s.plain_english || s.latex}
                    style={{ ...typography.body, fontSize: 14, color: colors.text }}
                  />
                ))}
                {p.student_answer != null && (
                  <Text style={styles.answer}>Answer: {p.student_answer}</Text>
                )}
              </>
            )}
          </View>
        ))}

        <View style={styles.actions}>
          <Button label="Looks right" onPress={() => act(confirmExtraction)} loading={acting} />
          <Button
            label="The reader got it wrong"
            variant="secondary"
            onPress={() => act(flagExtraction)}
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
