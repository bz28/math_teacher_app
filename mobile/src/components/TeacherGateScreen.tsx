import { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import { Eyebrow } from "./Eyebrow";
import { useColors, spacing, typography, radii, type ColorPalette } from "../theme";

const WEB_APP_URL = "https://veradicai.com";

interface TeacherGateScreenProps {
  onLogout: () => void;
}

/**
 * Graceful gate for teacher / admin accounts. The teacher dashboard
 * (rosters, grading, gradebook) is desktop-shaped and lives on the web,
 * so rather than dropping a teacher into the student study UI — or, for
 * MFA-enabled teachers, a broken login — we route them here with a clear
 * "use the web app" message and a way out.
 */
export function TeacherGateScreen({ onLogout }: TeacherGateScreenProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="laptop-outline" size={30} color={colors.primary} />
        </View>
        <Eyebrow style={styles.eyebrow}>Teacher account</Eyebrow>
        <Text style={styles.title}>Your dashboard{"\n"}lives on the web</Text>
        <Text style={styles.body}>
          Rosters, grading, and your gradebook are built for a bigger
          screen. Open Veradic on the web to manage your classes — the
          mobile app is for students.
        </Text>
        <View style={styles.actions}>
          <Button label="Open the web app" onPress={() => Linking.openURL(WEB_APP_URL)} />
          <Button label="Log out" variant="ghost" onPress={onLogout} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.xxl + 4,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceAlt2,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.xl,
    },
    eyebrow: {
      marginBottom: spacing.md,
    },
    title: {
      ...typography.displaySerif,
      color: colors.text,
      marginBottom: spacing.lg,
    },
    body: {
      ...typography.body,
      color: colors.textSecondary,
      lineHeight: 24,
      marginBottom: spacing.xxxl,
    },
    actions: {
      gap: spacing.md,
    },
  });
