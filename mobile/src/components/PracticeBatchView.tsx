import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { MathKeyboard } from "./MathKeyboard";
import { useSessionStore } from "../stores/session";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";
import { sessionScreenStyles as styles } from "./sessionScreenStyles";

interface PracticeBatchViewProps {
  onBack: () => void;
}

export function PracticeBatchView({ onBack }: PracticeBatchViewProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState("");
  const {
    phase,
    error,
    practiceBatch,
    submitPracticeAnswer,
    togglePracticeFlag,
    reset,
  } = useSessionStore();

  if (!practiceBatch) return null;

  const { problems, currentIndex, totalCount } = practiceBatch;
  const currentProblem = problems[currentIndex];

  const handlePracticeSubmit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
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
          <AnimatedPressable onPress={handleBack} style={styles.backWrap} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>
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
            inputAccessoryViewID="math-session"
          />
        </View>

        <View style={styles.buttons}>
          <AnimatedPressable
            style={[(phase === "thinking" || !input.trim()) && styles.buttonDisabled]}
            onPress={handlePracticeSubmit}
            disabled={phase === "thinking" || !input.trim()}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.button, styles.submitButton]}
            >
              {phase === "thinking" ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitText}>Answer</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.button, styles.flagButton, practiceBatch.flags[currentIndex] && styles.flagButtonActive]}
            onPress={() => togglePracticeFlag(currentIndex)}
          >
            <Ionicons
              name={practiceBatch.flags[currentIndex] ? "flag" : "flag-outline"}
              size={16}
              color={practiceBatch.flags[currentIndex] ? colors.warningDark : colors.textMuted}
              style={{ marginRight: spacing.xs }}
            />
            <Text style={[styles.flagText, practiceBatch.flags[currentIndex] && styles.flagTextActive]}>
              {practiceBatch.flags[currentIndex] ? "Flagged" : "Flag"}
            </Text>
          </AnimatedPressable>
        </View>
      </ScrollView>
      <MathKeyboard onInsert={handleInsert} accessoryID="math-session" />
    </KeyboardAvoidingView>
  );
}
