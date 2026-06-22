import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import {
  useFonts,
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from "@expo-google-fonts/instrument-serif";
import { AccountScreen } from "./src/components/AccountScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { BottomTabBar, type TabKey } from "./src/components/BottomTabBar";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { HistoryListScreen } from "./src/components/HistoryListScreen";
import { WeakSpotsScreen } from "./src/components/WeakSpotsScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { PaywallScreen } from "./src/components/PaywallScreen";
import { SessionReviewScreen } from "./src/components/SessionReviewScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { SolveScreen } from "./src/components/SolveScreen";
import { TeacherGateScreen } from "./src/components/TeacherGateScreen";
import { useColors } from "./src/theme";
import { clearAuth, fetchMe, getUserId, getUserRole, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { decideLanding } from "./src/utils/routing";
import { initRevenueCat } from "./src/services/revenuecat";
import { useEntitlementStore } from "./src/stores/entitlements";
import { useOnboardingFlags } from "./src/stores/onboardingFlags";
import { usePaywallStore } from "./src/stores/paywall";
import { useSessionStore } from "./src/stores/session";
import { loadThemePref } from "./src/stores/themePref";
import { ONBOARDING_KEY } from "./src/constants/storageKeys";

type Screen = "auth" | "onboarding" | "solve" | "account" | "session" | "session-review" | "history-list" | "weak-spots" | "teacher-gate";

const TAB_SCREENS: Screen[] = ["solve", "history-list", "weak-spots", "account"];
const SCREEN_TO_TAB: Record<string, TabKey> = {
  solve: "solve",
  "history-list": "history",
  "weak-spots": "review",
  account: "account",
};
const TAB_TO_SCREEN: Record<TabKey, Screen> = {
  solve: "solve",
  history: "history-list",
  review: "weak-spots",
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
  const paywallVisible = usePaywallStore((s) => s.visible);
  const paywallTrigger = usePaywallStore((s) => s.trigger);
  const hidePaywall = usePaywallStore((s) => s.hide);

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
      if (!restored) {
        setScreen("auth");
        return;
      }
      // Teachers/admins get the web-app gate, not the student UI.
      if (decideLanding(getUserRole()) === "teacher-gate") {
        setScreen("teacher-gate");
        return;
      }
      const userId = getUserId();
      if (userId) {
        await initRevenueCat(userId).catch(() => {});
      }
      fetchEntitlements().catch(() => {});
      setScreen("solve");
    });
  }, [fetchEntitlements, initializeOnboardingFlags]);

  if (screen === null) return null;

  // Compute the active screen as a child node, then render it once
  // with the global PaywallScreen mounted alongside. This way any
  // screen can open the paywall via usePaywallStore.show(...) without
  // needing its own local <PaywallScreen> mount.
  let screenNode: React.ReactNode = null;

  if (screen === "onboarding") {
    screenNode = (
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
  } else if (screen === "auth") {
    screenNode = (
      <SafeAreaProvider>
        <AuthScreen
          onAuth={async (justRegistered) => {
            // Resolve role before routing so a teacher who signs in lands
            // on the gate, not the student UI. Registration is always a
            // student, so we skip the role check on that path.
            const me = await fetchMe();
            if (!justRegistered && decideLanding(me?.role) === "teacher-gate") {
              setScreen("teacher-gate");
              return;
            }
            setScreen("solve");
            const userId = me?.id ?? getUserId();
            // Await init for new registrations so the post-signup paywall
            // doesn't open before RC is configured — otherwise getOfferings
            // throws and the trial pitch silently collapses to "Subscribe
            // Now $79.99/yr" while the hero still says "Start your free
            // trial". For existing logins we don't need to block.
            if (userId) {
              if (justRegistered) {
                await initRevenueCat(userId).catch(() => {});
              } else {
                initRevenueCat(userId).catch(() => {});
              }
            }
            fetchEntitlements().catch(() => {});
            if (justRegistered) {
              usePaywallStore.getState().show("post_signup");
            }
          }}
          onTeacherGate={() => setScreen("teacher-gate")}
          defaultToRegister={fromOnboarding}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if (screen === "teacher-gate") {
    screenNode = (
      <SafeAreaProvider>
        <TeacherGateScreen
          onLogout={async () => {
            await clearAuth();
            setScreen("auth");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if (TAB_SCREENS.includes(screen)) {
    // Tab screens — wrapped in shared layout with bottom tab bar
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
    } else if (screen === "weak-spots") {
      content = (
        <WeakSpotsScreen
          subject={subject}
          onSubjectChange={setSubject}
          onStartPractice={() => setScreen("session")}
        />
      );
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

    screenNode = (
      <SafeAreaProvider>
        <View style={tabHostStyle}>
          <View style={{ flex: 1 }}>{content}</View>
          {tabBar}
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if (screen === "session-review" && reviewSessionId) {
    screenNode = (
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
  } else if (screen === "session") {
    screenNode = (
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

  return (
    <>
      {screenNode}
      <PaywallScreen
        visible={paywallVisible}
        trigger={paywallTrigger}
        onClose={hidePaywall}
        onPurchaseComplete={() => {
          hidePaywall();
          fetchEntitlements().catch(() => {});
        }}
      />
    </>
  );
}

export default function App() {
  // Kick off Instrument Serif loading but don't gate first paint on it.
  // If the font registration is slow (Expo Go in particular), serif
  // headlines briefly render with the system fallback and swap in once
  // loaded. A flash of unstyled text is much better than a black screen
  // forever if useFonts never resolves.
  useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
