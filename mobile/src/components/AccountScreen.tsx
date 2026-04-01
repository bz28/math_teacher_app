import { useState } from "react";
import { Alert, Linking, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { PaywallScreen } from "./PaywallScreen";
import { getUserName } from "../services/api";
import { useEntitlementStore } from "../stores/entitlements";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface AccountScreenProps {
  onBack: () => void;
  onLogout: () => void;
}

export function AccountScreen({ onBack, onLogout }: AccountScreenProps) {
  const name = getUserName();
  const isPro = useEntitlementStore((s) => s.isPro);
  const status = useEntitlementStore((s) => s.status);
  const expiresAt = useEntitlementStore((s) => s.expiresAt);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const handleManageSubscription = () => {
    // Open native subscription management
    const url = Platform.OS === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";
    Linking.openURL(url);
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: onLogout },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <BackButton onPress={onBack} />

      <Text style={styles.title}>Account</Text>

      {/* User info */}
      <View style={[styles.card, shadows.sm]}>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{name ?? "—"}</Text>
        </View>
      </View>

      {/* Subscription */}
      <View style={[styles.card, shadows.sm]}>
        <Text style={styles.cardTitle}>Subscription</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Plan</Text>
          <View style={styles.planBadge}>
            <Text style={[styles.planBadgeText, isPro && styles.planBadgeTextPro]}>
              {isPro ? "Pro" : "Free"}
            </Text>
          </View>
        </View>
        {isPro && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <Text style={[styles.value, { textTransform: "capitalize" }]}>{status}</Text>
            </View>
            {expiresAt && (
              <View style={styles.row}>
                <Text style={styles.label}>Renews</Text>
                <Text style={styles.value}>
                  {new Date(expiresAt).toLocaleDateString()}
                </Text>
              </View>
            )}
          </>
        )}

        {isPro ? (
          <AnimatedPressable style={styles.manageButton} onPress={handleManageSubscription} scaleDown={0.97}>
            <Text style={styles.manageButtonText}>Manage Subscription</Text>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable onPress={() => setPaywallVisible(true)} scaleDown={0.97}>
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.upgradeButton}
            >
              <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
            </LinearGradient>
          </AnimatedPressable>
        )}
      </View>

      {/* Logout */}
      <AnimatedPressable style={styles.logoutButton} onPress={handleLogout} scaleDown={0.97}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.logoutText}>Log Out</Text>
      </AnimatedPressable>

      <PaywallScreen
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPurchaseComplete={() => { setPaywallVisible(false); fetchEntitlements(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    ...typography.bodyBold,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  label: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
  },
  value: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  planBadge: {
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  planBadgeText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 12,
  },
  planBadgeTextPro: {
    color: colors.primary,
  },
  manageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  manageButtonText: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 14,
  },
  upgradeButton: {
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  upgradeButtonText: {
    ...typography.bodyBold,
    color: colors.white,
    fontSize: 14,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
  },
  logoutText: {
    ...typography.bodyBold,
    color: colors.error,
    fontSize: 14,
  },
});
