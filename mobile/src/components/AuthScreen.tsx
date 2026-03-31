import { useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { LoginForm } from "./LoginForm";
import { useFadeInUp } from "../hooks/useFadeInUp";
import { checkEmail, register, saveTokens, saveUserName } from "../services/api";
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

  const handleNameNext = () => {
    if (!name.trim()) return;
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRegisterStep("grade");
  };

  const handleGradeNext = () => {
    if (!selectedGrade) return;
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAuth();
    } catch (e) {
      setError((e as Error).message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    return <LoginForm onAuth={onAuth} onSwitchToRegister={switchMode} />;
  }

  // ── Register Step 1: Name ──────────────────────────────
  if (registerStep === "name") {
    return <NameStep
      name={name}
      onNameChange={setName}
      onNext={handleNameNext}
      onSwitch={switchMode}
      stepNumber={stepNumber}
    />;
  }

  // ── Register Step 2: Grade ─────────────────────────────
  if (registerStep === "grade") {
    return <GradeStep
      name={name}
      selectedGrade={selectedGrade}
      onGradeSelect={setSelectedGrade}
      onNext={handleGradeNext}
      onBack={() => setRegisterStep("name")}
      stepNumber={stepNumber}
    />;
  }

  // ── Register Step 3: Credentials ───────────────────────
  return <CredentialsStep
    name={name}
    email={email}
    onEmailChange={setEmail}
    password={password}
    onPasswordChange={setPassword}
    showPassword={showPassword}
    onTogglePassword={() => setShowPassword(!showPassword)}
    loading={loading}
    error={error}
    onSubmit={handleRegisterSubmit}
    onBack={() => setRegisterStep("grade")}
    onSwitch={switchMode}
    stepNumber={stepNumber}
  />;
}

/* ── Step 1: Name ─────────────────────────────────────────── */

function NameStep({ name, onNameChange, onNext, onSwitch, stepNumber }: {
  name: string;
  onNameChange: (v: string) => void;
  onNext: () => void;
  onSwitch: () => void;
  stepNumber: number;
}) {
  const headerAnim = useFadeInUp(0, 500);
  const inputAnim = useFadeInUp(200, 500);
  const buttonAnim = useFadeInUp(400, 500);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Animated.View style={[styles.header, headerAnim]}>
          <Text style={styles.titleEmoji}>👋</Text>
          <Text style={styles.title}>What should we{"\n"}call you?</Text>
          <StepIndicator current={stepNumber} total={3} />
        </Animated.View>

        <Animated.View style={[styles.form, inputAnim]}>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={onNameChange}
              placeholder="Your first name"
              autoCapitalize="words"
              autoFocus
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
              onSubmitEditing={onNext}
            />
          </View>

          {name.trim() ? (
            <Animated.Text style={[styles.namePreview, buttonAnim]}>
              We'll say: Hi, {name.trim()}! 👋
            </Animated.Text>
          ) : null}

          <AnimatedPressable
            style={!name.trim() && styles.buttonDisabled}
            onPress={onNext}
            disabled={!name.trim()}
            scaleDown={0.97}
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
        </Animated.View>

        <TouchableOpacity onPress={onSwitch} style={styles.switchButton}>
          <Text style={styles.switchText}>
            Already have an account?{" "}
            <Text style={styles.switchTextBold}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ── Step 2: Grade ────────────────────────────────────────── */

function GradeStep({ name, selectedGrade, onGradeSelect, onNext, onBack, stepNumber }: {
  name: string;
  selectedGrade: typeof GRADES[number] | null;
  onGradeSelect: (g: typeof GRADES[number]) => void;
  onNext: () => void;
  onBack: () => void;
  stepNumber: number;
}) {
  const headerAnim = useFadeInUp(0, 400);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <AnimatedPressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </AnimatedPressable>

        <Animated.View style={[styles.header, headerAnim]}>
          <Text style={styles.title}>Nice to meet you,{"\n"}{name.trim()}!</Text>
          <StepIndicator current={stepNumber} total={3} />
          <Text style={styles.subtitle}>
            What grade are you in?
          </Text>
        </Animated.View>

        <View style={styles.gradeGrid}>
          {GRADES.map((g, i) => (
            <GradeCard
              key={g.label}
              grade={g}
              selected={selectedGrade?.label === g.label}
              onSelect={() => {
                onGradeSelect(g);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              delay={100 + i * 80}
            />
          ))}
        </View>

        <AnimatedPressable
          style={[
            { marginTop: spacing.xxl },
            !selectedGrade && styles.buttonDisabled,
          ]}
          onPress={onNext}
          disabled={!selectedGrade}
          scaleDown={0.97}
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

function GradeCard({ grade, selected, onSelect, delay }: {
  grade: typeof GRADES[number];
  selected: boolean;
  onSelect: () => void;
  delay: number;
}) {
  const anim = useFadeInUp(delay, 400);

  return (
    <Animated.View style={anim}>
      <AnimatedPressable
        style={[styles.gradeCard, shadows.sm, selected && styles.gradeCardSelected]}
        onPress={onSelect}
        scaleDown={0.97}
      >
        <Text style={[styles.gradeLabel, selected && styles.gradeLabelSelected]}>
          {grade.label}
        </Text>
        <Text style={[styles.gradeRange, selected && styles.gradeRangeSelected]}>
          {grade.range}
        </Text>
        {selected && (
          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
        )}
      </AnimatedPressable>
    </Animated.View>
  );
}

/* ── Step 3: Credentials ──────────────────────────────────── */

function CredentialsStep({ name, email, onEmailChange, password, onPasswordChange, showPassword, onTogglePassword, loading, error, onSubmit, onBack, onSwitch, stepNumber }: {
  name: string;
  email: string;
  onEmailChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  loading: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
  onSwitch: () => void;
  stepNumber: number;
}) {
  const headerAnim = useFadeInUp(0, 400);
  const formAnim = useFadeInUp(200, 400);

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

        <Animated.View style={[styles.header, headerAnim]}>
          <Text style={styles.title}>Almost there,{"\n"}{name.trim()}!</Text>
          <StepIndicator current={stepNumber} total={3} />
        </Animated.View>

        <Animated.View style={[styles.form, formAnim]}>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={onEmailChange}
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
              onChangeText={onPasswordChange}
              placeholder="Password (8+ characters)"
              secureTextEntry={!showPassword}
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={onTogglePassword}
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
            onPress={onSubmit}
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
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </Animated.View>

        <TouchableOpacity onPress={onSwitch} style={styles.switchButton}>
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
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  titleEmoji: {
    fontSize: 40,
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

  // Name preview
  namePreview: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    fontSize: 14,
    marginBottom: spacing.xs,
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
