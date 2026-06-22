import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import { useFadeInUp } from "../hooks/useFadeInUp";
import { forgotPassword, login, saveTokens } from "../services/api";
import { isMfaChallenge } from "../utils/routing";
import { errorMessage } from "../utils/errorMessage";
import { useColors, useGradients, spacing, radii, typography, gradients, type ColorPalette } from "../theme";

interface LoginFormProps {
  /** Called on successful login. The optional `justRegistered` flag
   *  is forwarded from AuthScreen but is always omitted here — login
   *  is never a "first-time" event. */
  onAuth: (justRegistered?: boolean) => void;
  /** Called when login returns an MFA challenge (teacher/admin-only) — the
   *  app has no MFA flow, so these accounts are routed to the web gate. */
  onTeacherGate: () => void;
  onSwitchToRegister: () => void;
}

export function LoginForm({ onAuth, onTeacherGate, onSwitchToRegister }: LoginFormProps) {
  const colors = useColors();
  const gradients = useGradients();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logoAnim = useFadeInUp(0, 500);
  const headerAnim = useFadeInUp(100, 500);
  const formAnim = useFadeInUp(300, 500);
  const switchAnim = useFadeInUp(500, 400);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await login(email.trim().toLowerCase(), password);
      // An MFA challenge (no tokens) means a teacher/admin account — the
      // app can't complete MFA, so route them to the web gate instead of
      // saving undefined tokens.
      if (isMfaChallenge(resp)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onTeacherGate();
        return;
      }
      await saveTokens(resp.access_token!, resp.refresh_token!);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAuth();
    } catch (e) {
      setError(errorMessage(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert("Email required", "Enter your email address above first.");
      return;
    }
    try {
      await forgotPassword(trimmed);
      Alert.alert(
        "Check your email",
        "If an account exists for that email, we've sent a password reset link.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Error", errorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Animated.View style={logoAnim}>
            <Eyebrow style={styles.brandEyebrow}>Veradic</Eyebrow>
          </Animated.View>
          <Animated.View style={headerAnim}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to continue learning</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.form, formAnim]}>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry={!showPassword}
              placeholderTextColor={colors.textMuted}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleForgotPassword}
            style={styles.forgotButton}
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <AnimatedPressable
            style={(loading || !email || !password) && styles.buttonDisabled}
            onPress={handleLogin}
            disabled={loading || !email || !password}
            scaleDown={0.97}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryButton}
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </Animated.View>

        <Animated.View style={switchAnim}>
          <TouchableOpacity onPress={onSwitchToRegister} style={styles.switchButton}>
            <Text style={styles.switchText}>
              Don't have an account?{" "}
              <Text style={styles.switchTextBold}>Register</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl + 4,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xxl + 4,
  },
  brandEyebrow: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.displaySerifItalic,
    fontSize: 36,
    lineHeight: 42,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
  },
  form: {
    gap: 14,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.inputBg,
  },
  inputIcon: {
    marginLeft: 14,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
    ...typography.body,
    lineHeight: 22,
    color: colors.text,
    includeFontPadding: false,
  },
  forgotButton: {
    alignSelf: "flex-end",
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  forgotText: {
    ...typography.label,
    color: colors.primary,
    fontSize: 13,
  },
  eyeButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButton: {
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.textOnPrimary,
    ...typography.button,
  },
  buttonDisabled: { opacity: 0.4 },
  switchButton: {
    marginTop: spacing.xl,
    alignItems: "center",
  },
  switchText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  switchTextBold: {
    color: colors.primary,
    fontWeight: "600",
  },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
  },
  error: { color: colors.error, fontSize: 14 },
});
