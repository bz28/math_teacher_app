import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
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
import { useColors } from "./src/theme";
import { clearAuth, fetchAndStoreUserId, getUserId, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { initRevenueCat } from "./src/services/revenuecat";
import { useEntitlementStore } from "./src/stores/entitlements";
import { useOnboardingFlags } from "./src/stores/onboardingFlags";
import { useSessionStore } from "./src/stores/session";
import { loadThemePref } from "./src/stores/themePref";
import { ONBOARDING_KEY } from "./src/constants/storageKeys";

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
  const colors = useColors();
  const tabHostStyle = useMemo(
    () => ({ flex: 1, backgroundColor: colors.background }),
    [colors.background],
  );
  const setProblemQueue = useSessionStore((s) => s.setProblemQueue);
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const startPracticeBatch = useSessionStore((s) => s.startPracticeBatch);
  const initializeOnboardingFlags = useOnboardingFlags((s) => s.initialize);

  useEffect(() => {
    setOnSessionExpired(() => {
      setScreen("auth");
      setFromOnboarding(false);
    });

    // Hydrate theme preference from secure storage (best-effort)
    loadThemePref().catch(() => {});
    // Hydrate first-session onboarding flags so SolveScreen/SessionScreen
    // know whether to show coachmarks and the sample problem.
    initializeOnboardingFlags().catch(() => {});

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
  }, [fetchEntitlements, initializeOnboardingFlags]);

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
          />
        </ErrorBoundary>
      );
    } else if (screen === "history-list") {
      content = (
        <HistoryListScreen
          subject={subject}
          onSubjectChange={setSubject}
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
        <View style={tabHostStyle}>
          <View style={{ flex: 1 }}>{content}</View>
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
