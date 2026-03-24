import { ActivityIndicator, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../theme";
import type { WorkDiagnosis } from "../services/api";

interface DiagnosisTeaserProps {
  diagnosis: WorkDiagnosis | null;
  /** Whether a photo was submitted but diagnosis is still in flight */
  analyzing?: boolean;
}

export function DiagnosisTeaser({ diagnosis, analyzing }: DiagnosisTeaserProps) {
  if (diagnosis != null) {
    const color = diagnosis.has_issues ? colors.warningDark : colors.success;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs }}>
        <Ionicons name="camera" size={14} color={color} />
        <Text style={{ fontSize: 12, fontStyle: "italic", color }}>
          {diagnosis.summary}
        </Text>
      </View>
    );
  }

  if (analyzing) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={{ fontSize: 12, fontStyle: "italic", color: colors.textMuted }}>
          Analyzing...
        </Text>
      </View>
    );
  }

  return null;
}
