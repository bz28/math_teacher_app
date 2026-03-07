import { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
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
import { checkEmail, login, register, setAuthToken } from "../services/api";

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

const TOPICS = [
  { id: "arithmetic", label: "Arithmetic", icon: "+" },
  { id: "fractions", label: "Fractions", icon: "\u00BD" },
  { id: "algebra", label: "Algebra", icon: "x" },
  { id: "quadratics", label: "Quadratics", icon: "x\u00B2" },
  { id: "word_problems", label: "Word Problems", icon: "\uD83D\uDCDD" },
  { id: "geometry", label: "Geometry", icon: "\u25B3" },
];

type RegisterStep = "credentials" | "grade" | "topics";

export function AuthScreen({ onAuth, defaultToRegister = false }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(!defaultToRegister);
  const [registerStep, setRegisterStep] = useState<RegisterStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTopic = (id: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await login(email, password);
      setAuthToken(resp.access_token);
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
      setAuthToken(resp.access_token);
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

    // Check email availability first (most important to know early)
    setLoading(true);
    try {
      await checkEmail(email);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return;
    }
    setLoading(false);

    // Then validate password client-side
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

  const handleGradeNext = () => {
    if (!selectedGrade) return;
    setRegisterStep("topics");
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
            <Text style={styles.headerIcon}>{"\uD83C\uDF93"}</Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to continue learning
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor="#999"
            />

            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry={!showPassword}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.eyeText}>
                  {showPassword ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (loading || !email || !password) && styles.buttonDisabled,
              ]}
              onPress={handleLogin}
              disabled={loading || !email || !password}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>
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
            <Text style={styles.subtitle}>
              Step 1 of 3
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor="#999"
            />

            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                secureTextEntry={!showPassword}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.eyeText}>
                  {showPassword ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (loading || !email || !password) && styles.buttonDisabled,
              ]}
              onPress={handleCredentialsNext}
              disabled={loading || !email || !password}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
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
          <TouchableOpacity
            onPress={() => setRegisterStep("credentials")}
            style={styles.backButton}
          >
            <Text style={styles.backText}>{"\u2039"} Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>What grade are you in?</Text>
            <Text style={styles.subtitle}>
              Step 2 of 3 — we'll tailor problems to your level
            </Text>
          </View>

          <View style={styles.gradeGrid}>
            {GRADES.map((g) => (
              <TouchableOpacity
                key={g.label}
                style={[
                  styles.gradeCard,
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
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { marginTop: 24 },
              !selectedGrade && styles.buttonDisabled,
            ]}
            onPress={handleGradeNext}
            disabled={!selectedGrade}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Register: topics step
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          onPress={() => setRegisterStep("grade")}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{"\u2039"} Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>What are you working on?</Text>
          <Text style={styles.subtitle}>
            Step 3 of 3 — pick one or more topics
          </Text>
        </View>

        <View style={styles.topicGrid}>
          {TOPICS.map((t) => {
            const isSelected = selectedTopics.has(t.id);
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.topicCard,
                  isSelected && styles.topicCardSelected,
                ]}
                onPress={() => toggleTopic(t.id)}
              >
                <Text style={styles.topicIcon}>{t.icon}</Text>
                <Text
                  style={[
                    styles.topicLabel,
                    isSelected && styles.topicLabelSelected,
                  ]}
                >
                  {t.label}
                </Text>
                {isSelected && (
                  <Text style={styles.checkmark}>{"\u2713"}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            { marginTop: 24 },
            (loading || selectedTopics.size === 0) && styles.buttonDisabled,
          ]}
          onPress={handleRegisterSubmit}
          disabled={loading || selectedTopics.size === 0}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Create Account</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/* -- Styles -- */

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingBottom: 40,
  },

  // Header
  header: {
    alignItems: "center",
    marginBottom: 28,
  },
  headerIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1a1a1a",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: "#888",
    textAlign: "center",
    lineHeight: 22,
  },

  // Form
  form: {
    gap: 14,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#F9FAFB",
    color: "#1a1a1a",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#E0E4EA",
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
  },
  passwordInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    color: "#1a1a1a",
  },
  eyeButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  eyeText: { color: "#4A90D9", fontWeight: "600", fontSize: 14 },

  // Buttons
  primaryButton: {
    backgroundColor: "#4A90D9",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  buttonDisabled: { opacity: 0.4 },

  // Switch mode
  switchButton: {
    marginTop: 20,
    alignItems: "center",
  },
  switchText: {
    color: "#888",
    fontSize: 15,
  },
  switchTextBold: {
    color: "#4A90D9",
    fontWeight: "600",
  },

  // Back
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 16,
    marginBottom: 8,
  },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },

  // Error
  error: { color: "#E53935", textAlign: "center", fontSize: 14 },

  // Grade
  gradeGrid: { gap: 12 },
  gradeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: "#E8EBF0",
  },
  gradeCardSelected: {
    backgroundColor: "#EBF2FC",
    borderColor: "#4A90D9",
  },
  gradeLabel: {
    fontSize: 22,
    fontWeight: "700",
    color: "#333",
  },
  gradeLabelSelected: { color: "#4A90D9" },
  gradeRange: {
    fontSize: 14,
    color: "#888",
  },
  gradeRangeSelected: { color: "#5A9BE6" },

  // Topics
  topicGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  topicCard: {
    width: (width - 56 - 12) / 2,
    backgroundColor: "#F7F8FA",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E8EBF0",
  },
  topicCardSelected: {
    backgroundColor: "#EBF2FC",
    borderColor: "#4A90D9",
  },
  topicIcon: { fontSize: 28, marginBottom: 6 },
  topicLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  topicLabelSelected: { color: "#4A90D9" },
  checkmark: {
    position: "absolute",
    top: 8,
    right: 10,
    fontSize: 16,
    color: "#4A90D9",
    fontWeight: "bold",
  },
});
