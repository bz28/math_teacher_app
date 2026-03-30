import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Sentry from "@sentry/react-native";
import { AuthScreen } from "./src/components/AuthScreen";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { HistoryListScreen } from "./src/components/HistoryListScreen";
import { HomeScreen } from "./src/components/HomeScreen";
import { InputScreen } from "./src/components/InputScreen";
import { ModeSelectScreen, type Mode } from "./src/components/ModeSelectScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { SessionReviewScreen } from "./src/components/SessionReviewScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { clearAuth, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { useSessionStore } from "./src/stores/session";
import { colors } from "./src/theme";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
  enabled: !__DEV__,
});

const ONBOARDING_KEY = "onboarding_completed";

type Screen = "auth" | "onboarding" | "home" | "mode-select" | "input" | "session" | "session-review" | "history-list";

function AppRoot() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [mode, setMode] = useState<Mode>("learn");
  const [subject, setSubject] = useState("math");
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const startPracticeBatch = useSessionStore((s) => s.startPracticeBatch);

  useEffect(() => {
    setOnSessionExpired(() => {
      setScreen("auth");
      setFromOnboarding(false);
    });

    // TODO: remove — temp force onboarding for testing
    setScreen("onboarding"); return;
    SecureStore.getItemAsync(ONBOARDING_KEY).then(async (done) => {
      if (!done) {
        setScreen("onboarding");
        return;
      }
      const restored = await loadStoredAuth();
      setScreen(restored ? "home" : "auth");
    });
  }, []);

  if (screen === null) return null;

  if (screen === "onboarding") {
    return (
      <SafeAreaProvider>
        <OnboardingScreen
          onComplete={async () => {
            await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
            setFromOnboarding(true);
            setScreen("auth");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "auth") {
    return (
      <SafeAreaProvider>
        <AuthScreen onAuth={() => setScreen("home")} defaultToRegister={fromOnboarding} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <HomeScreen
          onSelect={(selectedSubject) => {
            setSubject(selectedSubject);
            setScreen("mode-select");
          }}
          onLogout={() => {
            Alert.alert("Log Out", "Are you sure you want to log out?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Log Out",
                style: "destructive",
                onPress: async () => {
                  await clearAuth();
                  setFromOnboarding(false);
                  setScreen("auth");
                },
              },
            ]);
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "mode-select") {
    return (
      <SafeAreaProvider>
        <ModeSelectScreen
          subject={subject}
          onSelect={(selectedMode) => {
            setMode(selectedMode);
            setScreen("input");
          }}
          onBack={() => setScreen("home")}
          onViewSession={(sessionId) => {
            setReviewSessionId(sessionId);
            setScreen("session-review");
          }}
          onViewAllHistory={() => setScreen("history-list")}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "history-list") {
    return (
      <SafeAreaProvider>
        <HistoryListScreen
          subject={subject}
          onBack={() => setScreen("mode-select")}
          onViewSession={(sessionId) => {
            setReviewSessionId(sessionId);
            setScreen("session-review");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "session-review" && reviewSessionId) {
    return (
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => setScreen("mode-select")}>
          <SessionReviewScreen
            sessionId={reviewSessionId}
            onBack={() => setScreen("mode-select")}
            onPracticeSimilar={async (problem) => {
              await startPracticeBatch(problem, 1);
              setScreen("session");
            }}
            onResume={async (sessionId) => {
              await resumeSession(sessionId);
              setScreen("session");
            }}
          />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "session") {
    return (
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => { setProblemQueue([]); setScreen("mode-select"); }}>
          <SessionScreen
            onBack={() => {
              setProblemQueue([]);
              setScreen("input");
            }}
            onHome={() => {
              setProblemQueue([]);
              setScreen("mode-select");
            }}
          />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // screen === "input"
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ErrorBoundary onReset={() => { setProblemQueue([]); setScreen("mode-select"); }}>
            <InputScreen
              mode={mode}
              subject={subject}
              onBack={() => {
                setProblemQueue([]);
                setScreen("mode-select");
              }}
              onSessionStart={() => setScreen("session")}
              onSessionError={() => setScreen("input")}
            />
          </ErrorBoundary>
        </KeyboardAvoidingView>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
});
