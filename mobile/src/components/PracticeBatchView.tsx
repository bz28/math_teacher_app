import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { GradientButton } from "./GradientButton";
import { MathKeyboard } from "./MathKeyboard";
import { useSessionStore } from "../stores/session";
import { captureWorkImage } from "../hooks/useCameraCapture";
import { colors, spacing, shadows } from "../theme";
import { sessionScreenStyles as styles } from "./sessionScreenStyles";

interface PracticeBatchViewProps {
  onBack: () => void;
}

export function PracticeBatchView({ onBack }: PracticeBatchViewProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const {
    phase,
    error,
    practiceBatch,
    submitPracticeAnswer,
    submitPracticeWork,
    skipPracticeProblem,
    togglePracticeFlag,
    reset,
  } = useSessionStore();

  // Haptic feedback on answer result
  useEffect(() => {
    if (!practiceBatch) return;
    if (practiceBatch.currentFeedback === "correct") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (practiceBatch.currentFeedback === "wrong") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setInput("");
    }
  }, [practiceBatch?.currentFeedback, practiceBatch?.currentIndex]);

  if (!practiceBatch) return null;

  const { problems, currentIndex, totalCount } = practiceBatch;
  const currentProblem = problems[currentIndex];

  const handleAttachWork = async () => {
    const base64 = await captureWorkImage();
    if (base64) setAttachedImage(base64);
  };

  const handlePracticeSubmit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    const image = attachedImage;
    const idx = currentIndex;

    if (!image) {
      // Nudge if no work attached
      Alert.alert(
        "Attach your work?",
        "You'll get feedback on exactly where you went wrong.",
        [
          {
            text: "Attach work",
            onPress: async () => {
              await handleAttachWork();
              // Don't auto-submit — let them tap Answer again with the image attached
            },
          },
          {
            text: "Skip",
            style: "cancel",
            onPress: async () => {
              setInput("");
              setAttachedImage(null);
              await submitPracticeAnswer(text);
            },
          },
        ],
      );
      return;
    }

    setInput("");
    setAttachedImage(null);
    // Fire diagnosis in background
    submitPracticeWork(idx, image, text);
    await submitPracticeAnswer(text);
  };

  const handleInsert = (value: string) => {
    setInput((prev) => prev + value);
    inputRef.current?.focus();
  };

  const handleBack = () => {
    reset();
    onBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <BackButton onPress={handleBack} />
          <View style={styles.headerBadge} accessibilityRole="text" accessibilityLabel={`Problem ${currentIndex + 1} of ${totalCount}`}>
            <Text style={styles.headerBadgeText}>
              {currentIndex + 1}/{totalCount}
            </Text>
          </View>
        </View>
        <View style={[styles.problemCard, shadows.sm]}>
          <Text style={styles.cardLabel}>Problem</Text>
          <Text style={styles.problemText}>{currentProblem.question}</Text>
        </View>
        <View style={styles.progressRow}>
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressBar,
                { width: `${(currentIndex / totalCount) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {currentIndex}/{totalCount}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Correct feedback */}
        {practiceBatch.currentFeedback === "correct" && (
          <View style={[styles.feedback, styles.feedbackCorrect]}>
            <Text style={[styles.feedbackTitle, styles.feedbackTitleCorrect]}>
              Correct!
            </Text>
          </View>
        )}

        {/* Wrong feedback */}
        {practiceBatch.currentFeedback === "wrong" && (
          <View style={[styles.feedback, styles.feedbackWrong]}>
            <Text style={[styles.feedbackTitle, styles.feedbackTitleWrong]}>
              Not quite, try again!
            </Text>
          </View>
        )}

        {practiceBatch.currentFeedback !== "correct" && (
          <>
            <Text style={styles.promptText}>Enter your final answer</Text>

            {error && (
              <View style={styles.errorWrap}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.error}>{error}</Text>
              </View>
            )}

            <View>
              <Text style={styles.inputLabel}>Your answer</Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Enter your answer..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handlePracticeSubmit}
                editable={phase !== "thinking"}
                inputAccessoryViewID="math-session"
              />
            </View>

            {/* Attach work button */}
            <AnimatedPressable
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                alignSelf: "flex-start",
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.lg,
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: attachedImage ? colors.success : colors.border,
                backgroundColor: attachedImage ? colors.successLight : "transparent",
                marginTop: spacing.md,
              }}
              onPress={handleAttachWork}
            >
              <Ionicons
                name={attachedImage ? "checkmark-circle" : "camera-outline"}
                size={18}
                color={attachedImage ? colors.success : colors.textSecondary}
              />
              <Text style={{
                fontSize: 14,
                fontWeight: "600",
                color: attachedImage ? colors.success : colors.textSecondary,
              }}>
                {attachedImage ? "Work attached" : "Attach your work"}
              </Text>
            </AnimatedPressable>

            <View style={styles.buttons}>
              <GradientButton
                onPress={handlePracticeSubmit}
                label="Answer"
                loading={phase === "thinking"}
                disabled={!input.trim()}
                style={styles.submitButton}
              />
              <AnimatedPressable
                style={[styles.button, styles.flagButton]}
                onPress={skipPracticeProblem}
                disabled={phase === "thinking"}
              >
                <Ionicons
                  name="play-skip-forward-outline"
                  size={16}
                  color={colors.textMuted}
                  style={{ marginRight: spacing.xs }}
                />
                <Text style={styles.flagText}>Skip</Text>
              </AnimatedPressable>
            </View>
          </>
        )}
      </ScrollView>
      <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />
    </KeyboardAvoidingView>
  );
}
