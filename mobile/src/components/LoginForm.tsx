import { useState } from "react";
import {
  ActivityIndicator,
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
import { AnimatedPressable } from "./AnimatedPressable";
import { login, saveTokens } from "../services/api";
import { colors, spacing, radii, typography, gradients } from "../theme";

interface LoginFormProps {
  onAuth: () => void;
  onSwitchToRegister: () => void;
}

export function LoginForm({ onAuth, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await login(email.trim().toLowerCase(), password);
      await saveTokens(resp.access_token, resp.refresh_token);
      onAuth();
    } catch (e) {
      setError((e as Error).message);
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
        <View style={styles.header}>
          <View style={styles.heroIconWrap}>
            <LinearGradient
              colors={gradients.primary}
              style={styles.heroIconGradient}
            >
              <Ionicons name="school" size={36} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to continue learning</Text>
        </View>

        <View style={styles.form}>
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

          <AnimatedPressable
            style={(loading || !email || !password) && styles.buttonDisabled}
            onPress={handleLogin}
            disabled={loading || !email || !password}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryButton}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </View>

        <TouchableOpacity onPress={onSwitchToRegister} style={styles.switchButton}>
          <Text style={styles.switchText}>
            Don't have an account?{" "}
            <Text style={styles.switchTextBold}>Register</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  heroIconWrap: {
    marginBottom: spacing.lg,
  },
  heroIconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.md,
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
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.inputBg,
  },
  inputIcon: {
    marginLeft: 14,
  },
  input: {
    flex: 1,
    padding: 14,
    ...typography.body,
    color: colors.text,
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
    color: colors.white,
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
