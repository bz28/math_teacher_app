import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { AccountScreen } from "./src/components/AccountScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { BottomTabBar, type TabKey } from "./src/components/BottomTabBar";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { HistoryListScreen } from "./src/components/HistoryListScreen";
import { LibraryScreen } from "./src/components/LibraryScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { SessionReviewScreen } from "./src/components/SessionReviewScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { SolveScreen } from "./src/components/SolveScreen";
import { colors } from "./src/theme";
import { clearAuth, fetchAndStoreUserId, getUserId, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { initRevenueCat } from "./src/services/revenuecat";
import { useEntitlementStore } from "./src/stores/entitlements";
import { useSessionStore } from "./src/stores/session";

const ONBOARDING_KEY = "onboarding_completed";

type Screen = "auth" | "onboarding" | "solve" | "account" | "session" | "session-review" | "history-list" | "library";

const TAB_SCREENS: Screen[] = ["solve", "history-list", "library", "account"];
const SCREEN_TO_TAB: Record<string, TabKey> = {
  solve: "solve",
  "history-list": "history",
  library: "library",
  account: "account",
};
const TAB_TO_SCREEN: Record<TabKey, Screen> = {
  solve: "solve",
  history: "history-list",
  library: "library",
  account: "account",
};

function AppRoot() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [subject, setSubject] = useState("math");
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const startPracticeBatch = useSessionStore((s) => s.startPracticeBatch);

  useEffect(() => {
    setOnSessionExpired(() => {
      setScreen("auth");
      setFromOnboarding(false);
    });

    SecureStore.getItemAsync(ONBOARDING_KEY).then(async (done) => {
      if (!done) {
        setScreen("onboarding");
        return;
      }
      const restored = await loadStoredAuth();
      if (restored) {
        const userId = getUserId();
        if (userId) {
          await initRevenueCat(userId).catch(() => {});
        }
        fetchEntitlements().catch(() => {});
      }
      setScreen(restored ? "solve" : "auth");
    });
  }, [fetchEntitlements]);

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
        <AuthScreen
          onAuth={async () => {
            setScreen("solve");
            const userId = getUserId() ?? await fetchAndStoreUserId();
            if (userId) {
              initRevenueCat(userId).catch(() => {});
            }
            fetchEntitlements().catch(() => {});
          }}
          defaultToRegister={fromOnboarding}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // Tab screens — wrapped in shared layout with bottom tab bar
  if (TAB_SCREENS.includes(screen)) {
    const tabBar = (
      <BottomTabBar
        active={SCREEN_TO_TAB[screen]}
        onChange={(tab) => setScreen(TAB_TO_SCREEN[tab])}
      />
    );

    let content: React.ReactNode = null;
    if (screen === "solve") {
      content = (
        <ErrorBoundary onReset={() => { setProblemQueue([]); setScreen("solve"); }}>
          <SolveScreen
            subject={subject}
            onSubjectChange={setSubject}
            onSessionStart={() => setScreen("session")}
            onSessionError={() => setScreen("solve")}
            onAccount={() => setScreen("account")}
            onHistory={() => setScreen("history-list")}
          />
        </ErrorBoundary>
      );
    } else if (screen === "history-list") {
      content = (
        <HistoryListScreen
          subject={subject}
          onBack={() => setScreen("solve")}
          onViewSession={(sessionId) => {
            setReviewSessionId(sessionId);
            setScreen("session-review");
          }}
        />
      );
    } else if (screen === "library") {
      content = <LibraryScreen />;
    } else if (screen === "account") {
      content = (
        <AccountScreen
          onBack={() => setScreen("solve")}
          onLogout={async () => {
            await clearAuth();
            setFromOnboarding(false);
            setScreen("auth");
          }}
        />
      );
    }

    return (
      <SafeAreaProvider>
        <View style={styles.tabHost}>
          <View style={styles.tabContent}>{content}</View>
          {tabBar}
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "session-review" && reviewSessionId) {
    return (
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => setScreen("solve")}>
          <SessionReviewScreen
            sessionId={reviewSessionId}
            onBack={() => setScreen("solve")}
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
        <ErrorBoundary onReset={() => { setProblemQueue([]); setScreen("solve"); }}>
          <SessionScreen
            onBack={() => {
              setProblemQueue([]);
              setScreen("solve");
            }}
            onHome={() => {
              setProblemQueue([]);
              setScreen("solve");
            }}
          />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  // Fallback (shouldn't hit) — redirect to solve
  return null;
}

const styles = StyleSheet.create({
  tabHost: { flex: 1, backgroundColor: colors.background },
  tabContent: { flex: 1 },
});

export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
