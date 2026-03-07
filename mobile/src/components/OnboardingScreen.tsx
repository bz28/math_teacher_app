import { useState } from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface OnboardingScreenProps {
  onComplete: () => void;
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

type Step = "welcome" | "grade" | "topics" | "modes";
const STEPS: Step[] = ["welcome", "grade", "topics", "modes"];

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const canContinue = () => {
    if (step === "grade") return selectedGrade !== null;
    if (step === "topics") return selectedTopics.size > 0;
    return true;
  };

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

  const toggleTopic = (id: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        {step === "grade" && (
          <GradeStep selected={selectedGrade} onSelect={setSelectedGrade} />
        )}
        {step === "topics" && (
          <TopicsStep selected={selectedTopics} onToggle={toggleTopic} />
        )}
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

        <TouchableOpacity
          style={[styles.nextButton, !canContinue() && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={!canContinue()}
        >
          <Text style={styles.nextText}>
            {isLast ? "Get Started" : "Continue"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ── Step Components ── */

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

function GradeStep({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (grade: string) => void;
}) {
  return (
    <View style={styles.stepTop}>
      <Text style={styles.stepTitle}>What grade are you in?</Text>
      <Text style={styles.stepSubtitle}>
        We'll tailor problems to your level.
      </Text>
      <View style={styles.gradeGrid}>
        {GRADES.map((g) => (
          <TouchableOpacity
            key={g.label}
            style={[
              styles.gradeCard,
              selected === g.label && styles.gradeCardSelected,
            ]}
            onPress={() => onSelect(g.label)}
          >
            <Text
              style={[
                styles.gradeLabel,
                selected === g.label && styles.gradeLabelSelected,
              ]}
            >
              {g.label}
            </Text>
            <Text
              style={[
                styles.gradeRange,
                selected === g.label && styles.gradeRangeSelected,
              ]}
            >
              {g.range}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function TopicsStep({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.stepTop}>
      <Text style={styles.stepTitle}>What are you working on?</Text>
      <Text style={styles.stepSubtitle}>Pick one or more topics.</Text>
      <View style={styles.topicGrid}>
        {TOPICS.map((t) => {
          const isSelected = selected.has(t.id);
          return (
            <TouchableOpacity
              key={t.id}
              style={[
                styles.topicCard,
                isSelected && styles.topicCardSelected,
              ]}
              onPress={() => onToggle(t.id)}
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
              {isSelected && <Text style={styles.checkmark}>{"\u2713"}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
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

      <Text style={styles.readyText}>You're all set — let's go!</Text>
    </View>
  );
}

/* ── Styles ── */

const { width } = Dimensions.get("window");

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
  buttonDisabled: { opacity: 0.4 },

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

  // Grade
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
    width: (width - 48 - 12) / 2,
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

  // Modes
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
