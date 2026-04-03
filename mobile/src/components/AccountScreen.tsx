import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AnimatedPressable } from "./AnimatedPressable";
import { BackButton } from "./BackButton";
import { PaywallScreen } from "./PaywallScreen";
import { clearAuth, deleteAccount, getUserName } from "../services/api";
import { useEntitlementStore } from "../stores/entitlements";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface AccountScreenProps {
  onBack: () => void;
  onLogout: () => void;
  onAccountDeleted?: () => void;
}

function UsageBar({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: string }) {
  const pct = limit > 0 ? used / limit : 0;
  const barColor = pct >= 1 ? colors.error : pct >= 0.8 ? colors.warningDark : colors.primary;
  return (
    <View style={styles.usageRow}>
      <View style={styles.usageLabel}>
        <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
        <Text style={styles.usageLabelText}>{label}</Text>
      </View>
      <View style={styles.usageRight}>
        <View style={styles.usageBar}>
          <View style={[styles.usageBarFill, { width: `${Math.min(pct * 100, 100)}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={[styles.usageCount, pct >= 1 && { color: colors.error }]}>{used} / {limit}</Text>
      </View>
    </View>
  );
}

export function AccountScreen({ onBack, onLogout, onAccountDeleted }: AccountScreenProps) {
  const name = getUserName();
  const isPro = useEntitlementStore((s) => s.isPro);
  const status = useEntitlementStore((s) => s.status);
  const expiresAt = useEntitlementStore((s) => s.expiresAt);
  const dailySessionsUsed = useEntitlementStore((s) => s.dailySessionsUsed);
  const dailySessionsLimit = useEntitlementStore((s) => s.dailySessionsLimit);
  const dailyScansUsed = useEntitlementStore((s) => s.dailyScansUsed);
  const dailyScansLimit = useEntitlementStore((s) => s.dailyScansLimit);
  const dailyChatsUsed = useEntitlementStore((s) => s.dailyChatsUsed);
  const dailyChatsLimit = useEntitlementStore((s) => s.dailyChatsLimit);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);
  const [paywallVisible, setPaywallVisible] = useState(false);

  // Delete account state
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const shakeAnim = useRef(new RNAnimated.Value(0)).current;

  const initial = (name ?? "?")[0].toUpperCase();

  const handleManageSubscription = () => {
    const url = Platform.OS === "ios"
      ? "https://apps.apple.com/account/subscriptions"
      : "https://play.google.com/store/account/subscriptions";
    Linking.openURL(url);
  };

  const triggerShake = () => {
    shakeAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      RNAnimated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleDeleteAccount = () => {
    const message = isPro
      ? "You have an active subscription. Please cancel it in your App Store/Play Store settings first, or you'll continue to be charged.\n\nThis will permanently delete your account and all your data. This action cannot be undone."
      : "This will permanently delete your account and all your data. This action cannot be undone.";

    Alert.alert("Delete Your Account?", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete Account",
        style: "destructive",
        onPress: () => {
          setDeletePassword("");
          setDeleteError(null);
          setDeleteModalVisible(true);
        },
      },
    ]);
  };

  const handleConfirmDelete = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Please enter your password");
      triggerShake();
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteAccount(deletePassword);
      setDeletePassword("");
      await clearAuth();
      setDeleteModalVisible(false);
      if (onAccountDeleted) { onAccountDeleted(); } else { onLogout(); }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setDeleteError(message);
      triggerShake();
    } finally {
      setDeleteLoading(false);
    }
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarCircle}
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </LinearGradient>
          <Text style={styles.profileName}>{name ?? "User"}</Text>
          <View style={[styles.planBadge, isPro ? styles.planBadgePro : styles.planBadgeFree]}>
            {isPro && <Ionicons name="star" size={12} color={colors.white} />}
            <Text style={[styles.planBadgeText, isPro ? styles.planBadgeTextPro : styles.planBadgeTextFree]}>
              {isPro ? "PRO" : "FREE"}
            </Text>
          </View>
        </View>

        {/* Subscription card */}
        {isPro && (
          <View style={[styles.card, shadows.sm]}>
            <Text style={styles.cardTitle}>Subscription</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <Text style={[styles.value, { textTransform: "capitalize" }]}>{status}</Text>
            </View>
            {expiresAt && (
              <View style={styles.row}>
                <Text style={styles.label}>Renews</Text>
                <Text style={styles.value}>{new Date(expiresAt).toLocaleDateString()}</Text>
              </View>
            )}
            <AnimatedPressable style={styles.manageButton} onPress={handleManageSubscription} scaleDown={0.97}>
              <Text style={styles.manageButtonText}>Manage Subscription</Text>
            </AnimatedPressable>
          </View>
        )}

        {/* Usage card — free users */}
        {!isPro && dailySessionsLimit < Infinity && (
          <View style={[styles.card, shadows.sm]}>
            <Text style={styles.cardTitle}>Daily Usage</Text>
            <UsageBar label="Problems" used={dailySessionsUsed} limit={dailySessionsLimit as number} icon="book-outline" />
            <UsageBar label="Scans" used={dailyScansUsed} limit={dailyScansLimit as number} icon="camera-outline" />
            <UsageBar label="Chats" used={dailyChatsUsed} limit={dailyChatsLimit as number} icon="chatbubble-outline" />
          </View>
        )}

        {/* Upgrade / Manage */}
        {!isPro && (
          <AnimatedPressable onPress={() => setPaywallVisible(true)} scaleDown={0.97}>
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.upgradeButton}
            >
              <Ionicons name="star" size={18} color={colors.white} />
              <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
            </LinearGradient>
          </AnimatedPressable>
        )}

        {/* Delete Account */}
        <AnimatedPressable style={styles.deleteButton} onPress={handleDeleteAccount} scaleDown={0.97}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          <Text style={styles.deleteText}>Delete Account</Text>
        </AnimatedPressable>

        {/* Logout */}
        <AnimatedPressable style={styles.logoutButton} onPress={handleLogout} scaleDown={0.97}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </AnimatedPressable>
      </ScrollView>

      <PaywallScreen
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onPurchaseComplete={() => { setPaywallVisible(false); fetchEntitlements(); }}
      />

      {/* Delete Account Password Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !deleteLoading && setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, shadows.lg]}>
            <View style={styles.modalAccent} />
            <Text style={styles.modalTitle}>Verify Your Identity</Text>
            <Text style={styles.modalSubtitle}>Enter your password to confirm deletion</Text>

            <RNAnimated.View style={[styles.modalInputWrap, { transform: [{ translateX: shakeAnim }] }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.modalInputIcon} />
              <TextInput
                style={styles.modalInput}
                value={deletePassword}
                onChangeText={(t) => { setDeletePassword(t); setDeleteError(null); }}
                placeholder="Password"
                secureTextEntry
                placeholderTextColor={colors.textMuted}
                editable={!deleteLoading}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={handleConfirmDelete}
              />
            </RNAnimated.View>

            {deleteError && (
              <Text style={styles.modalError}>{deleteError}</Text>
            )}

            <AnimatedPressable
              style={[styles.modalDeleteBtn, deleteLoading && { opacity: 0.6 }]}
              onPress={handleConfirmDelete}
              scaleDown={0.97}
              disabled={deleteLoading}
            >
              {deleteLoading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.modalDeleteBtnText}>Delete My Account</Text>
              )}
            </AnimatedPressable>

            <AnimatedPressable
              style={styles.modalCancelBtn}
              onPress={() => setDeleteModalVisible(false)}
              scaleDown={0.97}
              disabled={deleteLoading}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },

  // Profile header
  profileHeader: {
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.white,
  },
  profileName: {
    ...typography.heading,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  planBadgePro: {
    backgroundColor: colors.success,
  },
  planBadgeFree: {
    backgroundColor: colors.inputBg,
  },
  planBadgeText: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1,
  },
  planBadgeTextPro: {
    color: colors.white,
  },
  planBadgeTextFree: {
    color: colors.textSecondary,
  },

  // Cards
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

  // Usage bars
  usageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  usageLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: 90,
  },
  usageLabelText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  usageRight: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  usageBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
  },
  usageBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  usageCount: {
    ...typography.caption,
    color: colors.textMuted,
    width: 40,
    textAlign: "right",
  },

  // Buttons
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
    flexDirection: "row",
    gap: spacing.sm,
    borderRadius: radii.xl,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  upgradeButtonText: {
    ...typography.button,
    color: colors.white,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  deleteText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginTop: spacing.xs,
  },
  logoutText: {
    ...typography.bodyBold,
    color: colors.error,
    fontSize: 14,
  },

  // Delete account modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayDark,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl + 12,
    paddingTop: spacing.lg,
    overflow: "hidden",
  },
  modalAccent: {
    height: 3,
    backgroundColor: colors.error,
    borderRadius: 2,
    width: 40,
    alignSelf: "center",
    marginBottom: spacing.xl,
  },
  modalTitle: {
    ...typography.heading,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    fontSize: 14,
    marginBottom: spacing.xl,
  },
  modalInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.inputBg,
    marginBottom: spacing.sm,
  },
  modalInputIcon: {
    paddingLeft: spacing.lg,
  },
  modalInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  modalError: {
    ...typography.caption,
    color: colors.error,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  modalDeleteBtn: {
    backgroundColor: colors.error,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.md,
  },
  modalDeleteBtnText: {
    ...typography.button,
    color: colors.white,
  },
  modalCancelBtn: {
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  modalCancelText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 14,
  },
});
