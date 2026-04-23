import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { AnimatedPressable } from "./AnimatedPressable";
import { LoginForm } from "./LoginForm";
import { useFadeInUp } from "../hooks/useFadeInUp";
import { checkEmail, register, saveTokens, saveUserName } from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import { useColors, spacing, radii, typography, gradients, type ColorPalette } from "../theme";

interface AuthScreenProps {
  onAuth: () => void;
  defaultToRegister?: boolean;
}

const MIN_AGE = 13;
const MAX_AGE = 99;
const DEFAULT_AGE = 13;
const TOTAL_STEPS = 3;

// Derive backend grade_level from age. Three buckets match the old grade picker.
function ageToGradeLevel(age: number): number {
  if (age <= 14) return 8;   // middle school (6-8)
  if (age <= 18) return 12;  // high school (9-12)
  return 16;                  // college / adult
}

type RegisterStep = "name" | "age" | "credentials";

export function AuthScreen({ onAuth, defaultToRegister = false }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(!defaultToRegister);
  const [registerStep, setRegisterStep] = useState<RegisterStep>("name");

  // Form state
  const [name, setName] = useState("");
  const [age, setAge] = useState<number>(DEFAULT_AGE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameNext = () => {
    if (!name.trim()) return;
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRegisterStep("age");
  };

  const handleAgeNext = () => {
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
      const gradeLevel = ageToGradeLevel(age);
      const resp = await register(normalizedEmail, password, name.trim(), gradeLevel);
      await saveTokens(resp.access_token, resp.refresh_token);
      await saveUserName(name.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAuth();
    } catch (e) {
      setError(errorMessage(e));
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

  const stepNumber =
    registerStep === "name" ? 1 :
    registerStep === "age" ? 2 : 3;

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

  // ── Register Step 2: Age ───────────────────────────────
  if (registerStep === "age") {
    return <AgeStep
      name={name}
      age={age}
      onAgeChange={setAge}
      onNext={handleAgeNext}
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
    onBack={() => setRegisterStep("age")}
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
          <StepIndicator current={stepNumber} total={TOTAL_STEPS} />
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

/* ── Step 2: Age ─────────────────────────────────────────── */

function AgeStep({ name, age, onAgeChange, onNext, onBack, stepNumber }: {
  name: string;
  age: number;
  onAgeChange: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
  stepNumber: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headerAnim = useFadeInUp(0, 400);
  const pickerAnim = useFadeInUp(150, 400);
  const buttonAnim = useFadeInUp(300, 400);

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
          <Text style={styles.title}>How old are you,{"\n"}{name.trim()}?</Text>
          <StepIndicator current={stepNumber} total={TOTAL_STEPS} />
        </Animated.View>

        <Animated.View style={[styles.ageDisplayWrap, pickerAnim]}>
          <Text style={styles.ageNumber}>{age}</Text>
          <Text style={styles.ageUnit}>years old</Text>
        </Animated.View>

        <Animated.View style={[styles.sliderWrap, pickerAnim]}>
          <Slider
            style={styles.slider}
            minimumValue={MIN_AGE}
            maximumValue={MAX_AGE}
            step={1}
            value={age}
            onValueChange={(v) => {
              const next = Math.round(v);
              if (next !== age) {
                onAgeChange(next);
                Haptics.selectionAsync();
              }
            }}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>{MIN_AGE}</Text>
            <Text style={styles.sliderLabel}>{MAX_AGE}</Text>
          </View>
        </Animated.View>

        <Animated.View style={buttonAnim}>
          <AnimatedPressable
            style={{ marginTop: spacing.xxl }}
            onPress={onNext}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headerAnim = useFadeInUp(0, 400);
  const formAnim = useFadeInUp(200, 400);
  const emailRef = useRef<TextInput>(null);

  // Defer keyboard popup until the fade-in/bounce settles. Without this,
  // the header bounces in (Easing.back) at the same time KeyboardAvoidingView
  // shoves it upward as the keyboard rises — looks janky on iOS.
  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), 500);
    return () => clearTimeout(t);
  }, []);

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
          <StepIndicator current={stepNumber} total={TOTAL_STEPS} />
        </Animated.View>

        <Animated.View style={[styles.form, formAnim]}>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              ref={emailRef}
              style={styles.input}
              value={email}
              onChangeText={onEmailChange}
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.errorWrap}>
      <Ionicons name="alert-circle" size={16} color={colors.error} />
      <Text style={styles.error}>{message}</Text>
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────── */

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
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: "400",
    // typography.body declares lineHeight: 24 which makes iOS TextInput
    // render the glyph low inside the line box, so the text looks shifted
    // down relative to the leading icon. Tightening lineHeight + disabling
    // includeFontPadding centres the glyph cleanly.
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
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

  // Age picker (slider)
  ageDisplayWrap: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  ageNumber: {
    fontSize: 80,
    fontWeight: "800",
    color: colors.primary,
    lineHeight: 88,
  },
  ageUnit: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  sliderWrap: {
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    marginTop: -spacing.xs,
  },
  sliderLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
});
