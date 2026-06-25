import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { TextField } from "./TextField";
import { joinSection } from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { normalizeJoinCode } from "../utils/joinCode";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

interface Props {
  onBack: () => void;
  /** Called after a successful join so the host can refetch /auth/me and the dashboard. */
  onJoined: () => void;
}

/** Lets an already-logged-in student enroll in another class by code. */
export function JoinClassScreen({ onBack, onJoined }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const normalized = normalizeJoinCode(code);
    if (!normalized) return;
    setError(null);
    setLoading(true);
    try {
      await joinSection(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onJoined();
    } catch (e) {
      setError(errorMessage(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <AnimatedPressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </AnimatedPressable>

        <View style={styles.body}>
          <Eyebrow style={styles.eyebrow}>Join a class</Eyebrow>
          <Text style={styles.title}>Enter your{"\n"}class code</Text>
          <Text style={styles.subtitle}>
            Your teacher gives you a short code to join their class.
          </Text>

          <TextField
            icon="school-outline"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="Class code"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={submit}
            style={{ letterSpacing: 2 }}
            containerStyle={{ marginBottom: spacing.lg }}
          />

          {error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Button
            label="Join class"
            onPress={submit}
            loading={loading}
            disabled={!code.trim()}
            style={styles.submit}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1 },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  backText: { ...typography.label, color: colors.primary, fontSize: 15 },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  eyebrow: { marginBottom: spacing.md },
  title: {
    ...typography.displaySerif,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: spacing.xxl,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  errorText: { color: colors.error, fontSize: 14, flex: 1 },
  submit: { marginTop: spacing.sm },
});
