import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { FigureSvg } from "./FigureSvg";
import { MathText } from "./MathText";
import { getPracticeDetail, type PracticeSetDetail, type PracticeSetProblem } from "../services/api";
import { isAnswerCorrect } from "../utils/practiceCheck";
import { shuffleChoices } from "../utils/quiz";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

interface Props {
  assignmentId: string;
  onBack: () => void;
}

/** Extract human-readable text from an untyped solution step ({latex, plain_english, ...}). */
function stepText(step: Record<string, unknown>): string {
  const plain = typeof step.plain_english === "string" ? step.plain_english : "";
  const latex = typeof step.latex === "string" ? step.latex : "";
  return plain || latex;
}

export function PracticeSetScreen({ assignmentId, onBack }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<PracticeSetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setDetail(await getPracticeDetail(assignmentId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedPressable onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </AnimatedPressable>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.centered} />
      ) : error || !detail ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Couldn't load this practice set</Text>
          <AnimatedPressable onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Eyebrow style={styles.eyebrow}>{detail.course_name}</Eyebrow>
          <Text style={styles.title}>{detail.title}</Text>
          <Text style={styles.hint}>Practice — ungraded. Check your answers and review the steps.</Text>
          {detail.problems.map((p) => (
            <ProblemCard key={p.bank_item_id} problem={p} colors={colors} styles={styles} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProblemCard({
  problem,
  colors,
  styles,
}: {
  problem: PracticeSetProblem;
  colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  const isMc = (problem.distractors?.length ?? 0) > 0;
  const choices = useMemo(
    () => (isMc ? shuffleChoices([problem.final_answer ?? "", ...(problem.distractors ?? [])], problem.position) : []),
    [isMc, problem.final_answer, problem.distractors, problem.position],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);

  const answer = isMc ? selected ?? "" : typed;
  const correct = checked && isAnswerCorrect(answer, problem.final_answer);
  const steps = (problem.solution_steps ?? []) as Record<string, unknown>[];

  const check = () => {
    if (!answer.trim()) return;
    setChecked(true);
    Haptics.notificationAsync(
      isAnswerCorrect(answer, problem.final_answer)
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.problemNum}>Problem {problem.position}</Text>
      <MathText text={problem.question} style={{ ...typography.body, fontSize: 15, color: colors.text }} />
      {problem.figure_svg ? <FigureSvg svg={problem.figure_svg} /> : null}

      {isMc ? (
        <View style={styles.choices}>
          {choices.map((c, i) => {
            const isSel = selected === c;
            const isAns = checked && c === problem.final_answer;
            return (
              <AnimatedPressable
                key={i}
                style={[
                  styles.choice,
                  isSel && !checked && styles.choiceSel,
                  isAns && styles.choiceCorrect,
                  checked && isSel && !isAns && styles.choiceWrong,
                ]}
                onPress={() => !checked && setSelected(c)}
                disabled={checked}
              >
                <Text style={styles.choiceLetter}>{String.fromCharCode(65 + i)}</Text>
                <MathText text={c} style={{ ...typography.body, fontSize: 14, color: colors.text }} compact />
              </AnimatedPressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          style={[styles.input, checked && styles.inputChecked]}
          value={typed}
          onChangeText={setTyped}
          placeholder="Your answer"
          placeholderTextColor={colors.textMuted}
          editable={!checked}
        />
      )}

      {!checked ? (
        <Button label="Check" variant="secondary" onPress={check} disabled={!answer.trim()} />
      ) : (
        <View style={styles.feedback}>
          <View style={styles.feedbackRow}>
            <Ionicons
              name={correct ? "checkmark-circle" : "close-circle"}
              size={18}
              color={correct ? colors.success : colors.error}
            />
            <Text style={[styles.feedbackText, { color: correct ? colors.success : colors.error }]}>
              {correct ? "Correct!" : "Not quite"}
            </Text>
          </View>
          {!correct && problem.final_answer ? (
            <Text style={styles.answerLine}>Answer: {problem.final_answer}</Text>
          ) : null}
          {steps.length > 0 && (
            <View style={styles.steps}>
              {steps.map((s, i) => {
                const text = stepText(s);
                return text ? (
                  <MathText key={i} text={text} style={{ ...typography.body, fontSize: 13, color: colors.textSecondary }} />
                ) : null;
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backButton: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  backText: { ...typography.label, color: colors.primary, fontSize: 15 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
  eyebrow: {},
  title: { ...typography.displaySerifItalic, fontSize: 26, lineHeight: 32, color: colors.text },
  hint: { ...typography.body, color: colors.textSecondary, fontSize: 14 },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  problemNum: { ...typography.eyebrow, fontSize: 10, color: colors.textMuted },
  choices: { gap: spacing.sm },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  choiceSel: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  choiceCorrect: { borderColor: colors.success, backgroundColor: colors.surfaceAlt },
  choiceWrong: { borderColor: colors.error },
  choiceLetter: { ...typography.bodyBold, fontSize: 14, color: colors.primary, width: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 15,
    color: colors.text,
  },
  inputChecked: { opacity: 0.7 },
  feedback: { gap: spacing.sm },
  feedbackRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  feedbackText: { ...typography.bodyBold, fontSize: 15 },
  answerLine: { ...typography.bodyBold, fontSize: 14, color: colors.text },
  steps: { gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderLight },

  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.xxxl, gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  retryText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
});
