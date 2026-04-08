import { useMemo } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StepResponse } from "../services/api";
import { useColors, shadows } from "../theme";
import { makeSessionScreenStyles } from "./sessionScreenStyles";

interface FeedbackCardProps {
  response: StepResponse;
}

export function FeedbackCard({ response }: FeedbackCardProps) {
  const colors = useColors();
  const styles = useMemo(() => makeSessionScreenStyles(colors), [colors]);
  const isConversation = response.action === "conversation";

  return (
    <View
      style={[
        styles.feedback,
        shadows.sm,
        response.is_correct ? styles.feedbackCorrect :
        isConversation ? styles.feedbackConversation :
        styles.feedbackWrong,
      ]}
    >
      {isConversation && (
        <View style={styles.feedbackHeader}>
          <View style={[styles.feedbackIconWrap, { backgroundColor: colors.primaryBg }]}>
            <Ionicons name="school" size={14} color={colors.primary} />
          </View>
          <Text style={[styles.feedbackTitle, { color: colors.primary }]}>Tutor</Text>
        </View>
      )}
      {!isConversation && (
        <View style={styles.feedbackHeader}>
          <View style={[
            styles.feedbackIconWrap,
            { backgroundColor: response.is_correct ? colors.successLight : colors.errorLight },
          ]}>
            <Ionicons
              name={response.is_correct ? "checkmark" : "close"}
              size={18}
              color={response.is_correct ? colors.success : colors.error}
            />
          </View>
          <Text
            style={[
              styles.feedbackTitle,
              response.is_correct ? styles.feedbackTitleCorrect : styles.feedbackTitleWrong,
            ]}
          >
            {response.is_correct ? "Correct!" : "Not quite"}
          </Text>
        </View>
      )}
      <Text style={styles.feedbackText}>{response.feedback}</Text>
    </View>
  );
}
