import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { FigureSvg } from "./FigureSvg";
import { ImageZoomModal } from "./ImageZoomModal";
import { ListSkeleton } from "./SkeletonLoader";
import { MathText } from "./MathText";
import { captureWorkImage, pickWorkImageFromLibrary, pickWorkPdf } from "../hooks/useCameraCapture";
import {
  getHomework,
  getSubmission,
  submitHomework,
  type HomeworkDetail,
  type HomeworkGradeBreakdown,
  type HomeworkProblem,
  type SubmissionFile,
} from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { scoreColor } from "../utils/scoreColor";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

const MAX_FILES = 10;

interface Props {
  assignmentId: string;
  onBack: () => void;
  /** Called after a successful submit so the host can open the review/confirm step. */
  onSubmitted: () => void;
}

/** A staged page the student hasn't turned in yet. */
interface StagedFile {
  id: string;
  /** Raw base64 (no data: prefix) — what the submit endpoint expects. */
  base64: string;
  kind: "image" | "pdf";
  name?: string;
}

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function HomeworkScreen({ assignmentId, onBack, onSubmitted }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [hw, setHw] = useState<HomeworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The pages already turned in (for the submitted-state gallery).
  const [submittedFiles, setSubmittedFiles] = useState<SubmissionFile[]>([]);
  const [zoomFile, setZoomFile] = useState<SubmissionFile | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      setError(false);
      try {
        const detail = await getHomework(assignmentId);
        setHw(detail);
        if (detail.submitted) {
          // Best-effort: the gallery is a payoff, not load-critical — if it
          // fails the status block still renders.
          try {
            const sub = await getSubmission(assignmentId);
            setSubmittedFiles(sub.files ?? []);
          } catch {
            /* leave gallery empty */
          }
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [assignmentId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const isLate = hw?.due_at ? new Date(hw.due_at).getTime() < Date.now() : false;
  const atCap = files.length >= MAX_FILES;

  const stage = (base64: string, kind: StagedFile["kind"], name?: string) => {
    setSubmitError(null);
    setFiles((f) => [...f, { id: newId(), base64, kind, name }]);
  };

  const addPhoto = async () => {
    const base64 = await captureWorkImage();
    if (base64) stage(base64, "image");
  };
  const addFromLibrary = async () => {
    const base64 = await pickWorkImageFromLibrary();
    if (base64) stage(base64, "image");
  };
  const addPdf = async () => {
    try {
      const pdf = await pickWorkPdf();
      if (pdf) stage(pdf.base64, "pdf", pdf.filename);
    } catch {
      setSubmitError("Couldn't read that PDF — try again.");
    }
  };

  const chooseAdd = () => {
    if (atCap || submitting) return;
    Alert.alert("Add your work", "Photos or a PDF — up to 10 pages.", [
      { text: "Take a photo", onPress: addPhoto },
      { text: "Choose from library", onPress: addFromLibrary },
      { text: "Attach a PDF", onPress: addPdf },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const submit = async () => {
    if (files.length === 0 || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitHomework(
        assignmentId,
        files.map((f) => f.base64),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    } catch (e) {
      setSubmitError(errorMessage(e));
      setConfirming(false);
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
        <ListSkeleton rows={3} showCard />
      ) : error || !hw ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load this assignment</Text>
          <AnimatedPressable onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={colors.primary}
            />
          }
        >
          <Eyebrow style={styles.eyebrow}>{hw.course_name}</Eyebrow>
          <Text style={styles.title}>{hw.title}</Text>
          {hw.due_at && <Text style={styles.due}>{formatDue(hw.due_at)}</Text>}
          {hw.description ? <Text style={styles.description}>{hw.description}</Text> : null}

          {hw.problems.map((p) => (
            <ProblemBlock key={p.bank_item_id} problem={p} colors={colors} styles={styles} />
          ))}

          {hw.submitted ? (
            <SubmittedStatus
              hw={hw}
              files={submittedFiles}
              onZoom={setZoomFile}
              styles={styles}
              colors={colors}
            />
          ) : (
            <View style={styles.submitBlock}>
              <Text style={styles.submitLabel}>Turn in your work</Text>
              <Text style={styles.submitHint}>
                Add clear photos or a PDF of your completed work — up to {MAX_FILES} pages.
              </Text>

              {isLate && (
                <View style={styles.lateBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warningDark} />
                  <Text style={styles.lateText}>
                    This is past due. You can still turn it in — it'll be marked late so your
                    teacher knows.
                  </Text>
                </View>
              )}

              {files.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {files.map((f) => (
                    <View key={f.id} style={styles.thumbWrap}>
                      {f.kind === "pdf" ? (
                        <View style={[styles.thumb, styles.pdfThumb]}>
                          <Ionicons name="document-text-outline" size={26} color={colors.textSecondary} />
                          <Text style={styles.pdfThumbLabel} numberOfLines={1}>
                            {f.name ?? "PDF"}
                          </Text>
                        </View>
                      ) : (
                        <Image source={{ uri: `data:image/jpeg;base64,${f.base64}` }} style={styles.thumb} />
                      )}
                      <AnimatedPressable
                        style={styles.thumbRemove}
                        onPress={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                        accessibilityLabel="Remove page"
                      >
                        <Ionicons name="close" size={12} color={colors.textOnPrimary} />
                      </AnimatedPressable>
                    </View>
                  ))}
                </ScrollView>
              )}

              {!atCap && (
                <Button
                  label={files.length === 0 ? "Add your work" : "Add another page"}
                  variant="secondary"
                  onPress={chooseAdd}
                  disabled={submitting}
                />
              )}
              {atCap && <Text style={styles.capHint}>That's the max of {MAX_FILES} pages.</Text>}

              {submitError && (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              )}

              {files.length > 0 &&
                (confirming ? (
                  <View style={styles.confirmCard}>
                    <View style={styles.confirmHeader}>
                      <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
                      <Text style={styles.confirmTitle}>Ready to turn it in?</Text>
                    </View>
                    <Text style={styles.confirmBody}>
                      Your teacher will see exactly {files.length}{" "}
                      {files.length === 1 ? "page" : "pages"} — nothing else. Once you turn it
                      in you won't be able to change it, so take one last look if you'd like.
                    </Text>
                    <Button
                      label={isLate ? "Turn it in (late)" : "Turn it in"}
                      onPress={submit}
                      loading={submitting}
                    />
                    <Button
                      label="Not yet — let me look again"
                      variant="ghost"
                      onPress={() => setConfirming(false)}
                      disabled={submitting}
                    />
                  </View>
                ) : (
                  <Button
                    label={`Review & turn in ${files.length} ${files.length === 1 ? "page" : "pages"}`}
                    onPress={() => setConfirming(true)}
                  />
                ))}
            </View>
          )}
        </ScrollView>
      )}

      <ImageZoomModal file={zoomFile} onClose={() => setZoomFile(null)} />
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
  files,
  onZoom,
  styles,
  colors,
}: {
  hw: HomeworkDetail;
  files: SubmissionFile[];
  onZoom: (f: SubmissionFile) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  const graded = hw.grade_published_at != null && hw.final_score != null;
  // Join each feedback row to its problem by problem_id (== bank_item_id) so the
  // label carries the problem's real position, not its index in a payload the
  // backend may reorder or drop rows from. Matched rows read in assignment order;
  // an entry whose problem was since removed sinks to the end with a neutral label.
  const positionById = new Map(hw.problems.map((p) => [p.bank_item_id, p.position]));
  const breakdownRows = (hw.breakdown ?? [])
    .map((b) => ({ ...b, position: positionById.get(b.problem_id) ?? null }))
    .sort((a, z) => {
      if (a.position == null) return z.position == null ? 0 : 1;
      if (z.position == null) return -1;
      return a.position - z.position;
    });
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
          {breakdownRows.map((b) => (
            <View key={b.problem_id} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>
                {b.position != null ? `Problem ${b.position}` : "Additional feedback"}
              </Text>
              <Text style={[styles.breakdownPct, { color: statusColor(b.score_status, colors) }]}>
                {Math.round(b.percent)}%
              </Text>
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

      {files.length > 0 && (
        <View style={styles.gallery}>
          <Text style={styles.galleryLabel}>
            What your teacher sees · {files.length} {files.length === 1 ? "page" : "pages"}
          </Text>
          <View style={styles.galleryGrid}>
            {files.map((f, i) => {
              const isPdf = f.media_type === "application/pdf";
              return (
                <AnimatedPressable
                  key={i}
                  style={styles.galleryTile}
                  onPress={() => onZoom(f)}
                  accessibilityLabel={`View page ${i + 1}`}
                >
                  {isPdf ? (
                    <View style={[styles.galleryImage, styles.galleryPdf]}>
                      <Ionicons name="document-text-outline" size={28} color={colors.textSecondary} />
                      <Text style={styles.galleryPdfText}>PDF</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: `data:${f.media_type};base64,${f.data}` }}
                      style={styles.galleryImage}
                    />
                  )}
                  <Text style={styles.galleryCaption}>Page {i + 1}</Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Per-problem percent color, keyed on the canonical full/partial/zero judgment
 * rather than re-banding the raw percent — mirrors scoreColor's palette so a
 * problem row reads consistently with the overall score above it.
 */
function statusColor(status: HomeworkGradeBreakdown["score_status"], colors: ColorPalette): string {
  if (status === "full") return colors.success;
  if (status === "partial") return colors.textSecondary;
  return colors.error;
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
  lateBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  lateText: { ...typography.caption, color: colors.warningDark, fontSize: 13, flex: 1, lineHeight: 18 },
  thumbRow: { flexGrow: 0 },
  thumbWrap: { marginRight: spacing.sm },
  thumb: { width: 72, height: 96, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  pdfThumb: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.xs,
  },
  pdfThumbLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 10 },
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
  capHint: { ...typography.caption, color: colors.textMuted, fontSize: 12 },

  confirmCard: {
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  confirmHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  confirmTitle: { ...typography.heading, fontSize: 17, color: colors.text },
  confirmBody: { ...typography.body, color: colors.textSecondary, fontSize: 14, lineHeight: 21 },

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
  breakdownPct: { ...typography.bodyBold, fontSize: 14 },
  breakdownFeedback: { ...typography.caption, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },

  gallery: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  galleryLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  galleryTile: { width: 96, gap: 2 },
  galleryImage: {
    width: 96,
    height: 124,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  galleryPdf: { alignItems: "center", justifyContent: "center", gap: spacing.xs },
  galleryPdfText: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  galleryCaption: { ...typography.caption, color: colors.textMuted, fontSize: 11, textAlign: "center" },

  errorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorText: { color: colors.error, fontSize: 14, flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xxxl, gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
