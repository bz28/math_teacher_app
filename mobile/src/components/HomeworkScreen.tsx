import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { FigureSvg } from "./FigureSvg";
import { MathText } from "./MathText";
import { captureWorkImage } from "../hooks/useCameraCapture";
import { getHomework, submitHomework, type HomeworkDetail, type HomeworkProblem } from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { scoreColor } from "../utils/scoreColor";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

interface Props {
  assignmentId: string;
  onBack: () => void;
  /** Called after a successful submit so the host can open the review/confirm step. */
  onSubmitted: () => void;
}

export function HomeworkScreen({ assignmentId, onBack, onSubmitted }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [hw, setHw] = useState<HomeworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setHw(await getHomework(assignmentId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const addPhoto = async () => {
    const base64 = await captureWorkImage();
    if (base64) setPhotos((p) => [...p, base64]);
  };

  const submit = async () => {
    if (photos.length === 0 || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitHomework(assignmentId, photos);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    } catch (e) {
      setSubmitError(errorMessage(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      ) : error || !hw ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load this assignment</Text>
          <AnimatedPressable onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Eyebrow style={styles.eyebrow}>{hw.course_name}</Eyebrow>
          <Text style={styles.title}>{hw.title}</Text>
          {hw.due_at && <Text style={styles.due}>{formatDue(hw.due_at)}</Text>}
          {hw.description ? <Text style={styles.description}>{hw.description}</Text> : null}

          {hw.problems.map((p) => (
            <ProblemBlock key={p.bank_item_id} problem={p} colors={colors} styles={styles} />
          ))}

          {hw.submitted ? (
            <SubmittedStatus hw={hw} styles={styles} colors={colors} />
          ) : (
            <View style={styles.submitBlock}>
              <Text style={styles.submitLabel}>Submit your work</Text>
              <Text style={styles.submitHint}>
                Take a clear photo of your handwritten work for each page.
              </Text>
              {photos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {photos.map((b64, i) => (
                    <View key={i} style={styles.thumbWrap}>
                      <Image source={{ uri: `data:image/jpeg;base64,${b64}` }} style={styles.thumb} />
                      <AnimatedPressable
                        style={styles.thumbRemove}
                        onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                        accessibilityLabel="Remove photo"
                      >
                        <Ionicons name="close" size={12} color={colors.textOnPrimary} />
                      </AnimatedPressable>
                    </View>
                  ))}
                </ScrollView>
              )}
              <Button
                label={photos.length === 0 ? "Take a photo" : "Add another page"}
                variant="secondary"
                onPress={addPhoto}
                disabled={submitting}
              />
              {submitError && (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              )}
              {photos.length > 0 && (
                <Button
                  label={`Submit ${photos.length} ${photos.length === 1 ? "page" : "pages"}`}
                  onPress={submit}
                  loading={submitting}
                />
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProblemBlock({
  problem,
  colors,
  styles,
}: {
  problem: HomeworkProblem;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.problem}>
      <Text style={styles.problemNum}>Problem {problem.position}</Text>
      <MathText text={problem.question} style={{ ...typography.body, fontSize: 15, color: colors.text }} />
      {problem.figure_svg ? <FigureSvg svg={problem.figure_svg} /> : null}
      {problem.format === "mcq" && problem.mcq_choices.length > 0 && (
        <View style={styles.choices}>
          {problem.mcq_choices.map((c, i) => (
            <View key={i} style={styles.choice}>
              <Text style={styles.choiceLetter}>{String.fromCharCode(65 + i)}</Text>
              <MathText text={c} style={{ ...typography.body, fontSize: 14, color: colors.text }} compact />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SubmittedStatus({
  hw,
  styles,
  colors,
}: {
  hw: HomeworkDetail;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  const graded = hw.grade_published_at != null && hw.final_score != null;
  return (
    <View style={styles.statusBlock}>
      {graded ? (
        <>
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.statusTitle}>Graded</Text>
            <Text style={[styles.statusScore, { color: scoreColor(hw.final_score!, colors) }]}>
              {Math.round(hw.final_score!)}%
            </Text>
          </View>
          {hw.breakdown?.map((b, i) => (
            <View key={b.problem_id} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Problem {i + 1}</Text>
              <Text style={styles.breakdownPct}>{Math.round(b.percent)}%</Text>
              {b.feedback ? <Text style={styles.breakdownFeedback}>{b.feedback}</Text> : null}
            </View>
          ))}
        </>
      ) : (
        <View style={styles.statusRow}>
          <Ionicons name="hourglass-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.statusTitle}>Submitted — in review</Text>
        </View>
      )}
    </View>
  );
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  backText: { ...typography.label, color: colors.primary, fontSize: 15 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
  eyebrow: {},
  title: { ...typography.displaySerifItalic, fontSize: 26, lineHeight: 32, color: colors.text },
  due: { ...typography.label, color: colors.textSecondary, fontSize: 13 },
  description: { ...typography.body, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },

  problem: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  problemNum: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },
  choices: { gap: spacing.sm, marginTop: spacing.xs },
  choice: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  choiceLetter: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.primary,
    width: 20,
  },

  submitBlock: { gap: spacing.md, marginTop: spacing.lg },
  submitLabel: { ...typography.heading, fontSize: 18, color: colors.text },
  submitHint: { ...typography.body, color: colors.textSecondary, fontSize: 14 },
  thumbRow: { flexGrow: 0 },
  thumbWrap: { marginRight: spacing.sm },
  thumb: { width: 72, height: 96, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },

  statusBlock: {
    backgroundColor: colors.surfaceAlt2,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusTitle: { ...typography.bodyBold, fontSize: 16, color: colors.text, flex: 1 },
  statusScore: { ...typography.bodyBold, fontSize: 18 },
  breakdownRow: { gap: 2, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  breakdownLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  breakdownPct: { ...typography.bodyBold, fontSize: 14, color: colors.text },
  breakdownFeedback: { ...typography.caption, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },

  errorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorText: { color: colors.error, fontSize: 14, flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xxxl, gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
