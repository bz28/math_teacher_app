import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface OnboardingScreenProps {
  onComplete: () => void;
}

type Step = "welcome" | "modes";
const STEPS: Step[] = ["welcome", "modes"];

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.progressRow}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === stepIndex && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.content}>
        {step === "welcome" && <WelcomeStep />}
        {step === "modes" && <ModesStep />}
      </View>

      {/* Navigation */}
      <View style={styles.nav}>
        {stepIndex > 0 ? (
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backText}>{"\u2039"} Back</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}

        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextText}>
            {isLast ? "Get Started" : "Continue"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* -- Step Components -- */

function WelcomeStep() {
  return (
    <View style={styles.stepCenter}>
      <Text style={styles.welcomeIcon}>{"\uD83C\uDF93"}</Text>
      <Text style={styles.welcomeTitle}>Welcome to Math Tutor</Text>
      <Text style={styles.welcomeSubtitle}>
        Learn math step-by-step, at your pace.
      </Text>
      <View style={styles.featureList}>
        <FeatureRow
          icon={"\uD83D\uDCA1"}
          text="Get guided through each step — never just the answer"
        />
        <FeatureRow
          icon={"\uD83C\uDFAF"}
          text="Practice with similar problems until you've got it"
        />
        <FeatureRow
          icon={"\uD83D\uDCAC"}
          text="Ask questions anytime — your AI tutor is always here"
        />
      </View>
    </View>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function ModesStep() {
  return (
    <View style={styles.stepTop}>
      <Text style={styles.stepTitle}>Two ways to study</Text>
      <Text style={styles.stepSubtitle}>Use both to master any topic.</Text>

      <View style={styles.modeCard}>
        <Text style={styles.modeIcon}>{"\uD83D\uDCD6"}</Text>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeLabel}>Learn Mode</Text>
          <Text style={styles.modeDesc}>
            We break the problem into steps and guide you through each one.
            Hints start vague and get more specific — you always do the
            thinking.
          </Text>
        </View>
      </View>

      <View style={styles.modeCard}>
        <Text style={styles.modeIcon}>{"\u270F\uFE0F"}</Text>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeLabel}>Practice Mode</Text>
          <Text style={styles.modeDesc}>
            Solve similar problems on your own to build confidence. Flag
            anything tricky and revisit it in Learn mode.
          </Text>
        </View>
      </View>

      <Text style={styles.readyText}>
        Create an account to start learning!
      </Text>
    </View>
  );
}

/* -- Styles -- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 24,
  },

  // Progress
  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D0D5DD",
  },
  dotActive: {
    backgroundColor: "#4A90D9",
    width: 24,
  },

  // Content
  content: {
    flex: 1,
    justifyContent: "center",
  },

  // Navigation
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
  },
  backButton: { padding: 8 },
  backText: { color: "#4A90D9", fontSize: 16, fontWeight: "600" },
  nextButton: {
    backgroundColor: "#4A90D9",
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  nextText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Welcome
  stepCenter: {
    alignItems: "center",
    paddingHorizontal: 8,
  },
  welcomeIcon: { fontSize: 64, marginBottom: 16 },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
    color: "#1a1a1a",
  },
  welcomeSubtitle: {
    fontSize: 17,
    color: "#666",
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },
  featureList: { gap: 20, width: "100%" },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIcon: { fontSize: 28 },
  featureText: { fontSize: 16, color: "#444", flex: 1, lineHeight: 22 },

  // Modes
  stepTop: { paddingTop: 16 },
  stepTitle: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#1a1a1a",
  },
  stepSubtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 28,
  },
  modeCard: {
    flexDirection: "row",
    backgroundColor: "#F0F4FF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "#4A90D9",
    alignItems: "flex-start",
  },
  modeIcon: { fontSize: 32, marginRight: 14, marginTop: 2 },
  modeTextWrap: { flex: 1 },
  modeLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginBottom: 6,
  },
  modeDesc: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
  },
  readyText: {
    fontSize: 16,
    color: "#4A90D9",
    fontWeight: "600",
    textAlign: "center",
    marginTop: 20,
  },
});
