import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { checkEmail, login, register, saveTokens } from "../services/api";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface AuthScreenProps {
  onAuth: () => void;
  defaultToRegister?: boolean;
}

const GRADES = [
  { label: "K-2", range: "Kindergarten - 2nd" },
  { label: "3-5", range: "3rd - 5th" },
  { label: "6-8", range: "6th - 8th" },
  { label: "9-12", range: "9th - 12th" },
];

type RegisterStep = "credentials" | "grade";

export function AuthScreen({ onAuth, defaultToRegister = false }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(!defaultToRegister);
  const [registerStep, setRegisterStep] = useState<RegisterStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await login(email, password);
      await saveTokens(resp.access_token, resp.refresh_token);
      onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await register(email, password, 8);
      await saveTokens(resp.access_token, resp.refresh_token);
      onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsNext = async () => {
    if (!email || !password) return;
    setError(null);

    setLoading(true);
    try {
      await checkEmail(email);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return;
    }
    setLoading(false);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain an uppercase letter");
      return;
    }
    if (!/\d/.test(password)) {
      setError("Password must contain a digit");
      return;
    }

    setRegisterStep("grade");
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setRegisterStep("credentials");
    setError(null);
  };

  // Login view
  if (isLogin) {
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
            <Text style={styles.subtitle}>
              Sign in to continue learning
            </Text>
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
              style={[
                (loading || !email || !password) && styles.buttonDisabled,
              ]}
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

          <TouchableOpacity onPress={switchMode} style={styles.switchButton}>
            <Text style={styles.switchText}>
              Don't have an account?{" "}
              <Text style={styles.switchTextBold}>Register</Text>
            </Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Register: credentials step
  if (registerStep === "credentials") {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.inner}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Create your account</Text>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>Step 1 of 2</Text>
            </View>
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
              style={[
                (loading || !email || !password) && styles.buttonDisabled,
              ]}
              onPress={handleCredentialsNext}
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
                  <Text style={styles.primaryButtonText}>Continue</Text>
                )}
              </LinearGradient>
            </AnimatedPressable>
          </View>

          <TouchableOpacity onPress={switchMode} style={styles.switchButton}>
            <Text style={styles.switchText}>
              Already have an account?{" "}
              <Text style={styles.switchTextBold}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Register: grade step
  if (registerStep === "grade") {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedPressable
            onPress={() => setRegisterStep("credentials")}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>

          <View style={styles.header}>
            <Text style={styles.title}>What grade are you in?</Text>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>Step 2 of 2</Text>
            </View>
            <Text style={styles.subtitle}>
              We'll tailor problems to your level
            </Text>
          </View>

          <View style={styles.gradeGrid}>
            {GRADES.map((g) => (
              <AnimatedPressable
                key={g.label}
                style={[
                  styles.gradeCard,
                  shadows.sm,
                  selectedGrade === g.label && styles.gradeCardSelected,
                ]}
                onPress={() => setSelectedGrade(g.label)}
              >
                <Text
                  style={[
                    styles.gradeLabel,
                    selectedGrade === g.label && styles.gradeLabelSelected,
                  ]}
                >
                  {g.label}
                </Text>
                <Text
                  style={[
                    styles.gradeRange,
                    selectedGrade === g.label && styles.gradeRangeSelected,
                  ]}
                >
                  {g.range}
                </Text>
                {selectedGrade === g.label && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </AnimatedPressable>
            ))}
          </View>

          {error && (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <AnimatedPressable
            style={[
              { marginTop: spacing.xxl },
              (loading || !selectedGrade) && styles.buttonDisabled,
            ]}
            onPress={handleRegisterSubmit}
            disabled={loading || !selectedGrade}
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
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
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
  scrollContent: {
    paddingHorizontal: spacing.xxl + 4,
    paddingBottom: 40,
  },

  // Header
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
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
  },
  stepBadge: {
    backgroundColor: colors.primaryBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    marginBottom: spacing.sm,
  },
  stepBadgeText: {
    ...typography.label,
    color: colors.primary,
  },

  // Form
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

  // Buttons
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

  // Switch mode
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

  // Back
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
  },
  backText: { color: colors.primary, ...typography.bodyBold },

  // Error
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
  },
  error: { color: colors.error, fontSize: 14 },

  // Grade
  gradeGrid: { gap: spacing.md },
  gradeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: colors.border,
  },
  gradeCardSelected: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  gradeLabel: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  gradeLabelSelected: { color: colors.primary },
  gradeRange: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    marginLeft: spacing.lg,
  },
  gradeRangeSelected: { color: colors.primaryLight },
});
