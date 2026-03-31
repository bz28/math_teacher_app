import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable } from "./AnimatedPressable";
import { GradientButton } from "./GradientButton";
import { colors, spacing, radii, typography, shadows } from "../theme";

interface ImagePreviewProps {
  imageUri: string;
  extracting: boolean;
  error: string | null;
  hasManualSelect: boolean;
  onExtractAll: () => void;
  onManualSelect: () => void;
  onBack: () => void;
}

export function ImagePreview({
  imageUri,
  extracting,
  error,
  hasManualSelect,
  onExtractAll,
  onManualSelect,
  onBack,
}: ImagePreviewProps) {
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <AnimatedPressable onPress={onBack} style={styles.backBtn} scaleDown={0.9}>
            <Ionicons name="chevron-back" size={22} color={colors.white} />
          </AnimatedPressable>
          <Text style={styles.title}>Extract Problems</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.imageWrap}>
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
        </View>

        <View style={styles.actions}>
          {extracting ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingTitle}>Extracting problems...</Text>
              <Text style={styles.loadingSubtitle}>This usually takes a few seconds</Text>
            </View>
          ) : (
            <>
              {error && (
                <View style={styles.errorCard}>
                  <Ionicons name="alert-circle" size={18} color={colors.warningDark} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              <GradientButton
                onPress={onExtractAll}
                label="Extract All Problems"
                style={styles.mainBtn}
              />
              {hasManualSelect && (
                <AnimatedPressable
                  onPress={onManualSelect}
                  style={styles.secondaryBtn}
                  scaleDown={0.97}
                >
                  <Ionicons name="crop-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.secondaryText}>Select areas manually</Text>
                </AnimatedPressable>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.xl,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  title: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 17,
    flex: 1,
    textAlign: "center" as const,
  },
  imageWrap: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
  },
  image: {
    width: "100%" as const,
    height: "100%" as const,
  },
  actions: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
    ...shadows.lg,
  },
  mainBtn: {
    borderRadius: radii.md,
  },
  secondaryBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  secondaryText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 14,
  },
  loadingCard: {
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  loadingTitle: {
    ...typography.bodyBold,
    color: colors.text,
  },
  loadingSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  errorCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.warningDark,
    flex: 1,
  },
});
