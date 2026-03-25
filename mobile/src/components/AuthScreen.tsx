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
import { checkEmail, login, register, saveTokens, saveUserName } from "../services/api";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface AuthScreenProps {
  onAuth: () => void;
  defaultToRegister?: boolean;
}

const GRADES = [
  { label: "K-2", range: "Kindergarten - 2nd", value: 2 },
  { label: "3-5", range: "3rd - 5th", value: 5 },
  { label: "6-8", range: "6th - 8th", value: 8 },
  { label: "9-12", range: "9th - 12th", value: 12 },
  { label: "College", range: "Undergraduate", value: 16 },
];

type RegisterStep = "name" | "grade" | "credentials";

export function AuthScreen({ onAuth, defaultToRegister = false }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(!defaultToRegister);
  const [registerStep, setRegisterStep] = useState<RegisterStep>("name");

  // Form state
  const [name, setName] = useState("");
  const [selectedGrade, setSelectedGrade] = useState<typeof GRADES[number] | null>(null);
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

  const handleNameNext = () => {
    if (!name.trim()) return;
    setError(null);
    setRegisterStep("grade");
  };

  const handleGradeNext = () => {
    if (!selectedGrade) return;
    setError(null);
    setRegisterStep("credentials");
  };

  const handleRegisterSubmit = async () => {
    if (!email || !password) return;
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await checkEmail(normalizedEmail);
      const resp = await register(normalizedEmail, password, name.trim(), selectedGrade!.value);
      await saveTokens(resp.access_token, resp.refresh_token);
      await saveUserName(name.trim());
      onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setRegisterStep("name");
    setError(null);
  };

  const stepNumber = registerStep === "name" ? 1 : registerStep === "grade" ? 2 : 3;

  // ── Login ──────────────────────────────────────────────
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

            {error && <ErrorRow message={error} />}

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

  // ── Register Step 1: Name ──────────────────────────────
  if (registerStep === "name") {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.inner}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.header}>
            <Text style={styles.title}>What's your name?</Text>
            <StepIndicator current={stepNumber} total={3} />
          </View>

          <View style={styles.form}>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="First name"
                autoCapitalize="words"
                autoFocus
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
                onSubmitEditing={handleNameNext}
              />
            </View>

            <AnimatedPressable
              style={!name.trim() && styles.buttonDisabled}
              onPress={handleNameNext}
              disabled={!name.trim()}
            >
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
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

  // ── Register Step 2: Grade ─────────────────────────────
  if (registerStep === "grade") {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedPressable
            onPress={() => setRegisterStep("name")}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </AnimatedPressable>

          <View style={styles.header}>
            <Text style={styles.title}>What grade are you in?</Text>
            <StepIndicator current={stepNumber} total={3} />
            <Text style={styles.subtitle}>
              This helps us improve your experience over time
            </Text>
          </View>

          <View style={styles.gradeGrid}>
            {GRADES.map((g) => (
              <AnimatedPressable
                key={g.label}
                style={[
                  styles.gradeCard,
                  shadows.sm,
                  selectedGrade?.label === g.label && styles.gradeCardSelected,
                ]}
                onPress={() => setSelectedGrade(g)}
              >
                <Text
                  style={[
                    styles.gradeLabel,
                    selectedGrade?.label === g.label && styles.gradeLabelSelected,
                  ]}
                >
                  {g.label}
                </Text>
                <Text
                  style={[
                    styles.gradeRange,
                    selectedGrade?.label === g.label && styles.gradeRangeSelected,
                  ]}
                >
                  {g.range}
                </Text>
                {selectedGrade?.label === g.label && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </AnimatedPressable>
            ))}
          </View>

          <AnimatedPressable
            style={[
              { marginTop: spacing.xxl },
              !selectedGrade && styles.buttonDisabled,
            ]}
            onPress={handleGradeNext}
            disabled={!selectedGrade}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </LinearGradient>
          </AnimatedPressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Register Step 3: Credentials ───────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <AnimatedPressable
          onPress={() => setRegisterStep("grade")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </AnimatedPressable>

        <View style={styles.header}>
          <Text style={styles.title}>Create your account</Text>
          <StepIndicator current={stepNumber} total={3} />
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
              autoFocus
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
              placeholder="Password (8+ characters)"
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

          {error && <ErrorRow message={error} />}

          <AnimatedPressable
            style={(loading || !email || !password) && styles.buttonDisabled}
            onPress={handleRegisterSubmit}
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
                <Text style={styles.primaryButtonText}>Create Account</Text>
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

/* ── Shared Components ──────────────────────────────────── */

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepRow}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.stepDot,
            i + 1 < current && styles.stepDotDone,
            i + 1 === current && styles.stepDotActive,
          ]}
        />
      ))}
    </View>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <View style={styles.errorWrap}>
      <Ionicons name="alert-circle" size={16} color={colors.error} />
      <Text style={styles.error}>{message}</Text>
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────── */

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
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
  },

  // Step indicator
  stepRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    width: 24,
    borderRadius: radii.pill,
  },
  stepDotDone: {
    backgroundColor: colors.primaryLight,
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
