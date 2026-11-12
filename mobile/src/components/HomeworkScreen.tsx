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
  checkPageOrientation,
  getHomework,
  getSubmission,
  retakeSubmission,
  submitHomework,
  type HomeworkDetail,
  type HomeworkGradeBreakdown,
  type HomeworkProblem,
  type SubmissionFile,
} from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { orientationCheckCopy } from "../utils/orientationCheckCopy";
import {
  boundedPageCheck,
  onlySomePagesSideways,
  orientationReport,
  pdfTooSmallError,
  sidewaysHint,
  sidewaysPrompt,
  stillSideways,
  turnInCountLabel,
} from "../utils/pageOrientation";
import { scoreColor } from "../utils/scoreColor";
import { NEXT_STEP_COPY } from "../utils/nextStep";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

const MAX_FILES = 10;

interface Props {
  assignmentId: string;
  onBack: () => void;
  /** Called after a successful submit so the host can open the review/confirm step. */
  onSubmitted: () => void;
  /** Back into the confirm screen for turned-in work whose reading the
   *  student never confirmed (they left before tapping Confirm). */
  onConfirmReading: () => void;
  /** Back into an open understanding check ("Save & exit" lands home). */
  onFinishCheck: (submissionId: string) => void;
  /** Open straight into retaking the photos (from the flagged screen's
   *  "Retake photos"). Only takes effect if the server allows a retake. */
  startRetake?: boolean;
}

/** A staged page the student hasn't turned in yet. */
interface StagedFile {
  id: string;
  /** Raw base64 (no data: prefix) — what the submit endpoint expects. */
  base64: string;
  kind: "image" | "pdf";
  name?: string;
  /** Clockwise quarter turns the student applied (0/90/180/270). The
   *  server stores the page turned this way. */
  rotation: number;
  /** Pages the check covered: 1 for a photo, one per page for a PDF up
   *  to the check's cap. What `sidewaysPages` is about. */
  pageCount: number;
  /** Every page in the file — what the teacher gets. */
  totalPages: number;
  /** Pages (1-based, within the file) the server's free pixel check reads
   *  as sideways, as sent. While any still is, turn-in is held. */
  sidewaysPages: number[];
  /** The student said "It's already upright" — the check can be wrong. */
  upright: boolean;
  /** The page check hasn't answered yet; turn-in waits for it. */
  checking: boolean;
  /** The page check answered in time. False after a failure or timeout,
   *  which holds nothing — reported at turn-in as "unchecked". */
  checked: boolean;
  /** PDFs: a JPEG of one page the server rendered, to show and turn. */
  preview?: string;
}

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** "Tue, Nov 10, 11:59 PM" in the student's own time zone. */
function formatClosedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One decimal, never rounded away: 10% off 85% is 76.5%. */
function oneDecimal(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function HomeworkScreen({
  assignmentId,
  onBack,
  onSubmitted,
  onConfirmReading,
  onFinishCheck,
  startRetake = false,
}: Props) {
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
  // The student flagged the reading and may replace their photos once
  // (server's `can_retake`); `retaking` swaps the turned-in view for the
  // upload block in retake mode.
  const [canRetake, setCanRetake] = useState(false);
  const [retaking, setRetaking] = useState(startRetake);

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
            setCanRetake(!!sub.can_retake);
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
  const isRetake = retaking && canRetake;
  // Reopened by the teacher after it was turned in: the upload block
  // again, for one more turn-in by their personal date.
  const isResubmit = !!hw?.can_resubmit && !isRetake;
  const atCap = files.length >= MAX_FILES;

  const stage = (base64: string, kind: StagedFile["kind"], name?: string) => {
    setSubmitError(null);
    const id = newId();
    setFiles((f) => [
      ...f,
      { id, base64, kind, name, rotation: 0, pageCount: 1, totalPages: 1, sidewaysPages: [], upright: false, checking: true, checked: false },
    ]);
    void checkPages(id, base64, kind);
  };

  /** Ask the server whether a staged file reads upright (every page of a
   *  PDF, as the reader sees it) and, for a PDF, whether any page is too
   *  small to read — that PDF is taken back off with the reason, since
   *  turn-in would refuse it. Best-effort: if the check fails, nothing is
   *  held, and turn-in still enforces the size floor. */
  const checkPages = async (id: string, base64: string, kind: StagedFile["kind"]) => {
    // Null on failure, timeout (CHECK_HOLD_MS) or a malformed answer (an
    // older API mid-deploy): nothing is held. The tip and the rotate
    // button still work.
    const res = await boundedPageCheck(async () =>
      checkPageOrientation(kind === "pdf" ? base64 : await orientationCheckCopy(base64)),
    );
    if (res && res.tooSmallPages.length > 0) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setSubmitError(pdfTooSmallError(res.tooSmallPages));
      return;
    }
    // Built whole, then applied in one step — never half an answer.
    const update: Partial<StagedFile> = res
      ? {
          pageCount: kind === "pdf" ? res.pageCount : 1,
          totalPages: kind === "pdf" ? res.totalPages : 1,
          sidewaysPages: res.sidewaysPages,
          preview: res.preview ?? undefined,
        }
      : {};
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...update, checking: false, checked: res !== null } : f)),
    );
  };

  const markUpright = (id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, upright: true } : f)));
  };

  const rotate = (id: string) => {
    Haptics.selectionAsync();
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, rotation: (f.rotation + 90) % 360 } : f)),
    );
  };

  // Turn-in page numbers of files the check still reads as sideways.
  // Turn-in waits until there are none, and for every check to answer.
  const sidewaysPages = files.flatMap((f, i) => (stillSideways(f) ? [i + 1] : []));
  const checking = files.some((f) => f.checking);
  const blocked = checking || sidewaysPages.length > 0;
  // Pages, not files: one 6-page PDF is "6 pages" of work.
  const turnInCount = turnInCountLabel(
    files.map((f) => ({ pdf: f.kind === "pdf", totalPages: f.totalPages, checked: f.checked })),
  );

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
    Alert.alert("Add your work", `Photos or a PDF — up to ${MAX_FILES} files.`, [
      { text: "Take a photo", onPress: addPhoto },
      { text: "Choose from library", onPress: addFromLibrary },
      { text: "Attach a PDF", onPress: addPdf },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const submit = async () => {
    if (files.length === 0 || submitting || blocked) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const pages = files.map((f) => f.base64);
      const rotations = files.map((f) => f.rotation);
      const orientations = files.map((f) => orientationReport(f, f.checked));
      if (isRetake && hw?.submission_id) {
        await retakeSubmission(hw.submission_id, pages, rotations, orientations);
      } else {
        await submitHomework(assignmentId, pages, rotations, orientations);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    } catch (e) {
      const message = errorMessage(e);
      // Closed while the screen was open: reload so it shows as closed.
      if (message.startsWith("This homework closed")) load(true);
      setSubmitError(message);
      setConfirming(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  // The turn-in that stands: shown as turned in, and below the upload
  // block while a reopen lets them turn it in again.
  const turnedIn = hw?.submitted ? (
    <>
      {hw.next_step && hw.submission_id ? (
        <NextStepCard
          step={hw.next_step}
          onPress={() =>
            hw.next_step === "confirm_reading"
              ? onConfirmReading()
              : onFinishCheck(hw.submission_id!)
          }
          styles={styles}
          colors={colors}
        />
      ) : null}
      <SubmittedStatus
        hw={hw}
        files={submittedFiles}
        onZoom={setZoomFile}
        styles={styles}
        colors={colors}
      />
    </>
  ) : null;

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

          {hw.submitted && !isRetake && !isResubmit ? (
            <>
              {turnedIn}
              {canRetake && (
                <View style={styles.nextStepCard}>
                  <Text style={styles.statusTitle}>Were your photos the problem?</Text>
                  <Text style={styles.nextStepHint}>
                    If a page was sideways, blurry or missing, take new photos and we'll read them
                    again. Your teacher still sees your first ones.
                  </Text>
                  <Button label="Retake photos" variant="secondary" onPress={() => setRetaking(true)} />
                </View>
              )}
            </>
          ) : hw.closed && hw.due_at ? (
            <View style={styles.closedBlock} accessibilityRole="summary">
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
              <View style={styles.closedMain}>
                <Text style={styles.submitLabel}>This homework is closed</Text>
                <Text style={styles.submitHint}>
                  It closed on {formatClosedAt(hw.due_at)}, so it can't be turned in anymore. If
                  you still need to turn it in, ask your teacher to reopen it for you.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.submitBlock}>
              <Text style={styles.submitLabel}>
                {isRetake ? "Retake your photos" : isResubmit ? "Turn it in again" : "Turn in your work"}
              </Text>
              <Text style={styles.submitHint}>
                {isRetake
                  ? "Add every page again, upright, in a bright spot. We'll read them fresh for you to check. Your teacher still sees your first photos, and you can only retake once."
                  : isResubmit
                    ? `Your teacher reopened this homework for you${hw.due_at ? `, until ${formatClosedAt(hw.due_at)}` : ""}. Add every page of your work. What you turn in now replaces your earlier turn-in and is graded fresh — your teacher still has the earlier one. You can turn it in again once.`
                    : `Add clear photos or a PDF of your completed work — up to ${MAX_FILES} files.`}
              </Text>
              <View style={styles.tipRow}>
                <Ionicons name="refresh" size={14} color={colors.primary} />
                <Text style={styles.tipText}>
                  Hold your phone so the writing is upright. If a page comes out sideways, turn it
                  with the rotate button — sideways pages get misread.
                </Text>
              </View>

              {isLate && (
                <View style={styles.lateBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warningDark} />
                  <Text style={styles.lateText}>
                    {hw.late_policy === "penalty_per_day"
                      ? "This is past due. You can still turn it in, but each day late takes 10% off your score: 85% a day late counts as 76.5%."
                      : "This is past due. You can still turn it in — it'll be marked late so your teacher knows."}
                  </Text>
                </View>
              )}

              {files.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {files.map((f) => (
                    <View key={f.id} style={styles.thumbWrap}>
                      {f.kind === "pdf" && !f.preview ? (
                        <View style={[styles.thumb, styles.pdfThumb]}>
                          <Ionicons name="document-text-outline" size={26} color={colors.textSecondary} />
                          <Text style={styles.pdfThumbLabel} numberOfLines={1}>
                            {f.name ?? "PDF"}
                          </Text>
                        </View>
                      ) : (
                        <>
                          {/* Whole page, turned the way it will be stored. */}
                          <View
                            style={[styles.thumb, styles.imageThumb, stillSideways(f) && styles.thumbSideways]}
                          >
                            <Image
                              source={{ uri: `data:image/jpeg;base64,${f.preview ?? f.base64}` }}
                              style={[styles.thumbImage, { transform: [{ rotate: `${f.rotation}deg` }] }]}
                              resizeMode="contain"
                            />
                          </View>
                          {/* Turning a PDF turns every page, so a PDF with only
                              some pages sideways gets no rotate button. */}
                          {!onlySomePagesSideways(f) && (
                            <AnimatedPressable
                              style={[styles.thumbRotate, stillSideways(f) && styles.thumbRotateAlert]}
                              onPress={() => rotate(f.id)}
                              hitSlop={8}
                              accessibilityLabel="Rotate page a quarter turn clockwise"
                            >
                              <Ionicons
                                name="refresh"
                                size={14}
                                color={stillSideways(f) ? colors.textOnPrimary : colors.primary}
                              />
                            </AnimatedPressable>
                          )}
                        </>
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

              {files.map((f, i) =>
                stillSideways(f) ? (
                  <View key={f.id} style={styles.sidewaysCard}>
                    <View style={styles.sidewaysRow}>
                      <Ionicons name="warning-outline" size={16} color={colors.warningDark} />
                      <Text style={styles.sidewaysText}>
                        Page {i + 1}: {sidewaysPrompt(f)}
                      </Text>
                    </View>
                    {/* The check is a pixel heuristic and can be wrong — a
                        student must never be stuck unable to turn in. */}
                    <AnimatedPressable
                      onPress={() => markUpright(f.id)}
                      hitSlop={8}
                      style={styles.uprightButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Page ${i + 1} is already upright`}
                    >
                      <Text style={styles.uprightText}>It's already upright</Text>
                    </AnimatedPressable>
                  </View>
                ) : null,
              )}

              {!atCap && (
                <Button
                  label={files.length === 0 ? "Add your work" : "Add another page"}
                  variant="secondary"
                  onPress={chooseAdd}
                  disabled={submitting}
                />
              )}
              {atCap && <Text style={styles.capHint}>That's the max of {MAX_FILES} files.</Text>}

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
                      <Text style={styles.confirmTitle}>
                        {isRetake ? "Ready to send your new photos?" : "Ready to turn it in?"}
                      </Text>
                    </View>
                    <Text style={styles.confirmBody}>
                      {isRetake
                        ? `These ${turnInCount} replace your first photos, and this is your one retake — so check every page is here and upright.`
                        : `Your teacher will see exactly ${turnInCount} — nothing else. Once you turn it in you won't be able to change it, so take one last look if you'd like.`}
                    </Text>
                    {sidewaysPages.length > 0 && (
                      <Text style={styles.sidewaysText}>{sidewaysHint(sidewaysPages)}</Text>
                    )}
                    <Button
                      label={isRetake ? (isLate ? "Send new photos (late)" : "Send new photos") : isLate ? "Turn it in (late)" : "Turn it in"}
                      onPress={submit}
                      loading={submitting}
                      disabled={blocked}
                    />
                    <Button
                      label="Not yet — let me look again"
                      variant="ghost"
                      onPress={() => setConfirming(false)}
                      disabled={submitting}
                    />
                  </View>
                ) : (
                  <>
                    {blocked && (
                      <Text style={styles.blockedHint}>
                        {checking ? "Checking your pages…" : sidewaysHint(sidewaysPages)}
                      </Text>
                    )}
                    <Button
                      label={`Review & turn in ${turnInCount}`}
                      onPress={() => setConfirming(true)}
                      disabled={blocked}
                    />
                  </>
                ))}
              {isRetake && (
                <Button
                  label="Keep my first photos"
                  variant="ghost"
                  onPress={() => {
                    setRetaking(false);
                    setFiles([]);
                    setConfirming(false);
                  }}
                  disabled={submitting}
                />
              )}
            </View>
          )}
          {isResubmit && turnedIn}
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

/** "One more step" on turned-in work — the only way back into the confirm
 *  screen or an open check once the student has left them. Primary-tinted,
 *  not a warning: the work is in and nothing waits on this. */
function NextStepCard({
  step,
  onPress,
  styles,
  colors,
}: {
  step: NonNullable<HomeworkDetail["next_step"]>;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ColorPalette;
}) {
  const copy = NEXT_STEP_COPY[step];
  return (
    <View style={styles.nextStepCard}>
      <View style={styles.statusRow}>
        <Ionicons
          name={step === "confirm_reading" ? "document-text-outline" : "chatbubble-ellipses-outline"}
          size={18}
          color={colors.primary}
        />
        <Text style={styles.statusTitle}>One more step</Text>
      </View>
      <Text style={styles.nextStepHint}>{copy.hint}</Text>
      <Button label={copy.label} onPress={onPress} />
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
          {hw.late_penalty > 0 && (
            <Text style={styles.latePenaltyText}>
              {oneDecimal(hw.final_score! + hw.late_penalty)}% for the work, then −
              {oneDecimal(hw.late_penalty)}% for turning it in late (10% of your score per day late)
            </Text>
          )}
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
  latePenaltyText: { ...typography.caption, color: colors.warningDark, fontSize: 13, lineHeight: 18 },
  // Stands where the upload block would be once a "Closed after due
  // date" homework is past due: neutral, it's a state not an error.
  closedBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
  },
  closedMain: { flex: 1, gap: spacing.xs },
  thumbRow: { flexGrow: 0 },
  thumbWrap: { marginRight: spacing.sm },
  // Square so a quarter-turned page still fits whole; PDFs match.
  thumb: { width: 96, height: 96, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  imageThumb: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImage: { width: 96, height: 96 },
  thumbSideways: { borderWidth: 2, borderColor: colors.warning },
  thumbRotate: {
    position: "absolute",
    bottom: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRotateAlert: { backgroundColor: colors.warning, borderColor: colors.warning },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  tipText: { ...typography.caption, color: colors.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 },
  sidewaysCard: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningBg,
  },
  sidewaysRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  uprightButton: { alignSelf: "flex-start", marginLeft: 16 + spacing.xs, paddingVertical: 2 },
  uprightText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  blockedHint: { ...typography.caption, color: colors.textSecondary, fontSize: 13, textAlign: "center" },
  sidewaysText: {
    ...typography.caption,
    color: colors.warningDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    flex: 1,
  },
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
  nextStepCard: {
    backgroundColor: colors.primaryBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  nextStepHint: { ...typography.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
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
