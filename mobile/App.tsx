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
import { BottomTabBar, PERSONAL_TABS, SCHOOL_TABS, type TabKey } from "./src/components/BottomTabBar";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { ExtractionConfirmScreen } from "./src/components/ExtractionConfirmScreen";
import { GradesScreen } from "./src/components/GradesScreen";
import { HistoryListScreen } from "./src/components/HistoryListScreen";
import { HomeworkScreen } from "./src/components/HomeworkScreen";
import { JoinClassScreen } from "./src/components/JoinClassScreen";
import { WeakSpotsScreen } from "./src/components/WeakSpotsScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { PaywallScreen } from "./src/components/PaywallScreen";
import { SchoolHomeScreen } from "./src/components/SchoolHomeScreen";
import { SessionReviewScreen } from "./src/components/SessionReviewScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { SolveScreen } from "./src/components/SolveScreen";
import { TeacherGateScreen } from "./src/components/TeacherGateScreen";
import { useColors } from "./src/theme";
import { clearAuth, fetchMe, getUserId, getUserRole, getUserSchoolId, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { decideLanding } from "./src/utils/routing";
import { initRevenueCat } from "./src/services/revenuecat";
import { useEntitlementStore } from "./src/stores/entitlements";
import { useOnboardingFlags } from "./src/stores/onboardingFlags";
import { usePaywallStore } from "./src/stores/paywall";
import { useSessionStore } from "./src/stores/session";
import { loadThemePref } from "./src/stores/themePref";
import { ONBOARDING_KEY } from "./src/constants/storageKeys";

type Screen = "auth" | "onboarding" | "solve" | "account" | "session" | "session-review" | "history-list" | "weak-spots" | "teacher-gate" | "school-home" | "grades" | "join-class" | "homework" | "extraction-confirm";

// Two tab sets share the same screen<->tab maps (each screen maps to exactly
// one tab key); only which screens form the bar differs by audience.
const PERSONAL_TAB_SCREENS: Screen[] = ["solve", "history-list", "weak-spots", "account"];
const SCHOOL_TAB_SCREENS: Screen[] = ["school-home", "grades", "solve", "account"];
const SCREEN_TO_TAB: Record<string, TabKey> = {
  solve: "solve",
  "history-list": "history",
  "weak-spots": "review",
  account: "account",
  "school-home": "school-home",
  grades: "grades",
};
const TAB_TO_SCREEN: Record<string, Screen> = {
  solve: "solve",
  history: "history-list",
  review: "weak-spots",
  account: "account",
  "school-home": "school-home",
  grades: "grades",
};

function AppRoot() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [subject, setSubject] = useState("math");
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [activeHomeworkId, setActiveHomeworkId] = useState<string | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);
  // School-enrolled students get a classroom-first tab set (Home/Grades/Study/
  // Account); everyone else keeps the personal-learner tabs. Set at auth time.
  const [isSchoolStudent, setIsSchoolStudent] = useState(false);
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
      setIsSchoolStudent(false);
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
      const landing = decideLanding(getUserRole(), getUserSchoolId());
      // Teachers/admins get the web-app gate, not the student UI.
      if (landing === "teacher-gate") {
        setScreen("teacher-gate");
        return;
      }
      const userId = getUserId();
      if (userId) {
        await initRevenueCat(userId).catch(() => {});
      }
      fetchEntitlements().catch(() => {});
      if (landing === "school-home") {
        setIsSchoolStudent(true);
        setScreen("school-home");
        return;
      }
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
            // Resolve role/school before routing so a teacher who signs in
            // lands on the gate and a school student lands on their home,
            // not the personal study UI.
            const me = await fetchMe();
            const landing = decideLanding(me?.role, me?.school_id);
            if (!justRegistered && landing === "teacher-gate") {
              setScreen("teacher-gate");
              return;
            }
            const userId = me?.id ?? getUserId();
            if (landing === "school-home") {
              setIsSchoolStudent(true);
              setScreen("school-home");
            } else {
              setScreen("solve");
            }
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
            // School students are covered by their school — never pitch them Pro.
            if (justRegistered && landing !== "school-home") {
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
            setIsSchoolStudent(false);
            setScreen("auth");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if ((isSchoolStudent ? SCHOOL_TAB_SCREENS : PERSONAL_TAB_SCREENS).includes(screen)) {
    // Tab screens — wrapped in shared layout with bottom tab bar. School
    // students get the classroom tab set; everyone else the personal one.
    const tabBar = (
      <BottomTabBar
        tabs={isSchoolStudent ? SCHOOL_TABS : PERSONAL_TABS}
        active={SCREEN_TO_TAB[screen]}
        onChange={(tab) => setScreen(TAB_TO_SCREEN[tab])}
      />
    );

    let content: React.ReactNode = null;
    if (screen === "school-home") {
      content = (
        <SchoolHomeScreen
          onJoinClass={() => setScreen("join-class")}
          onOpenAssignment={(id) => {
            setActiveHomeworkId(id);
            setScreen("homework");
          }}
        />
      );
    } else if (screen === "grades") {
      content = <GradesScreen />;
    } else if (screen === "solve") {
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
          onBack={() => setScreen(isSchoolStudent ? "school-home" : "solve")}
          onLogout={async () => {
            await clearAuth();
            setFromOnboarding(false);
            setIsSchoolStudent(false);
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
  } else if (screen === "join-class") {
    screenNode = (
      <SafeAreaProvider>
        <JoinClassScreen
          onBack={() => setScreen("school-home")}
          onJoined={async () => {
            // A successful join may have just turned a personal student into a
            // school student (school_id now set) — refresh and route home.
            await fetchMe();
            setIsSchoolStudent(true);
            setScreen("school-home");
          }}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if (screen === "homework" && activeHomeworkId) {
    screenNode = (
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => setScreen("school-home")}>
          <HomeworkScreen
            assignmentId={activeHomeworkId}
            onBack={() => setScreen("school-home")}
            onSubmitted={() => setScreen("extraction-confirm")}
          />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  } else if (screen === "extraction-confirm" && activeHomeworkId) {
    screenNode = (
      <SafeAreaProvider>
        <ErrorBoundary onReset={() => setScreen("school-home")}>
          <ExtractionConfirmScreen
            assignmentId={activeHomeworkId}
            onDone={() => setScreen("school-home")}
          />
        </ErrorBoundary>
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
