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
import { AuthScreen } from "./src/components/AuthScreen";
import { HomeScreen } from "./src/components/HomeScreen";
import { InputScreen } from "./src/components/InputScreen";
import { ModeSelectScreen, type Mode } from "./src/components/ModeSelectScreen";
import { OnboardingScreen } from "./src/components/OnboardingScreen";
import { SessionScreen } from "./src/components/SessionScreen";
import { clearAuth, loadStoredAuth, setOnSessionExpired } from "./src/services/api";
import { colors } from "./src/theme";

const ONBOARDING_KEY = "onboarding_completed";

type Screen = "auth" | "onboarding" | "home" | "mode-select" | "input" | "session";

export default function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [mode, setMode] = useState<Mode>("learn");
  const [practiceCount, setPracticeCount] = useState(3);
  const [problemQueue, setProblemQueue] = useState<string[]>([]);
  const [fromOnboarding, setFromOnboarding] = useState(false);

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
          onSelect={() => setScreen("mode-select")}
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
          onSelect={(selectedMode) => {
            setMode(selectedMode);
            setScreen("input");
          }}
          onBack={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (screen === "session") {
    return (
      <SafeAreaProvider>
        <SessionScreen onBack={() => {
          setProblemQueue([]);
          setScreen("input");
        }} />
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
          <InputScreen
            mode={mode}
            practiceCount={practiceCount}
            problemQueue={problemQueue}
            onProblemQueueChange={setProblemQueue}
            onPracticeCountChange={setPracticeCount}
            onBack={() => {
              setProblemQueue([]);
              setScreen("mode-select");
            }}
            onSessionStart={() => setScreen("session")}
            onSessionError={() => setScreen("input")}
          />
        </KeyboardAvoidingView>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
});
