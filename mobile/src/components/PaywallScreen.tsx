import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { PurchasesPackage } from "react-native-purchases";
import { AnimatedPressable } from "./AnimatedPressable";
import { getOfferings, purchasePackage, restorePurchases } from "../services/revenuecat";
import { redeemPromoCode } from "../services/api";
import { useEntitlementStore } from "../stores/entitlements";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onPurchaseComplete: () => void;
  trigger?: string;
}

type PlanId = "annual" | "weekly";

interface PlanOption {
  id: PlanId;
  label: string;
  badge?: string;
  trialText: string;
  priceText: string;
  perWeek?: string;
  pkg: PurchasesPackage | null;
}

const COMPARISONS = [
  { feature: "Problem sessions", free: "5 per day", pro: "Unlimited" },
  { feature: "Chat messages", free: "20 per day", pro: "Unlimited" },
  { feature: "Image scanning", free: "3 per day", pro: "Unlimited" },
  { feature: "Work diagnosis", free: "—", pro: "Full AI grading" },
];

const TRIGGER_MESSAGES: Record<string, { title: string; subtitle: string }> = {
  create_session: {
    title: "Daily Problem Limit Reached",
    subtitle: "Free accounts are limited to 5 problems per day. Upgrade to Pro for unlimited access.",
  },
  image_scan: {
    title: "Daily Scan Limit Reached",
    subtitle: "Free accounts are limited to 3 image scans per day. Upgrade to Pro for unlimited scans.",
  },
  chat_message: {
    title: "Daily Chat Limit Reached",
    subtitle: "Free accounts are limited to 20 chat messages per day. Upgrade to Pro for unlimited chat.",
  },
  work_diagnosis: {
    title: "Work Diagnosis is Pro Only",
    subtitle: "Upload your handwritten work and get AI-powered step-by-step grading.",
  },
};

const TERMS_URL = "https://veradic.ai/terms";
const PRIVACY_URL = "https://veradic.ai/privacy";

export function PaywallScreen({ visible, onClose, onPurchaseComplete, trigger }: PaywallProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("annual");
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoExpanded, setPromoExpanded] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => {
    if (!visible) return;
    setLoadingOfferings(true);
    setSelectedPlan("annual");
    setPromoCode("");
    setPromoExpanded(false);

    getOfferings()
      .then((offerings) => {
        const current = offerings.current;
        const annualPkg = current?.annual ?? null;
        const monthlyPkg = current?.monthly ?? null;
        const weeklyPkg = current?.weekly ?? monthlyPkg;
        setPlans(buildPlans(annualPkg, weeklyPkg));
      })
      .catch(() => {
        setPlans(buildPlans(null, null));
      })
      .finally(() => setLoadingOfferings(false));
  }, [visible]);

  const selectedPlanOption = plans.find((p) => p.id === selectedPlan);
  const ctaLabel = selectedPlanOption?.trialText
    ? "Start Free Trial"
    : "Subscribe";

  const handleSubscribe = async () => {
    const plan = plans.find((p) => p.id === selectedPlan);
    if (!plan?.pkg) {
      Alert.alert("Not Available", "This plan is not available right now. Please try again later.");
      return;
    }

    setPurchasing(true);
    try {
      const result = await purchasePackage(plan.pkg);
      if (result === null) {
        setPurchasing(false);
        return;
      }
      await fetchEntitlements();
      setPurchasing(false);
      onPurchaseComplete();
    } catch (err) {
      setPurchasing(false);
      Alert.alert("Purchase Failed", (err as Error).message ?? "Something went wrong. Please try again.");
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    try {
      await restorePurchases();
      await fetchEntitlements();
      setPurchasing(false);
      const { isPro } = useEntitlementStore.getState();
      if (isPro) {
        onPurchaseComplete();
      } else {
        Alert.alert("No Subscription Found", "We couldn't find an active subscription for this account.");
      }
    } catch (err) {
      setPurchasing(false);
      Alert.alert("Restore Failed", (err as Error).message ?? "Something went wrong. Please try again.");
    }
  };

  const handleRedeemPromo = async () => {
    setPromoLoading(true);
    try {
      const result = await redeemPromoCode(promoCode.trim());
      await fetchEntitlements();
      setPromoLoading(false);
      Alert.alert("Success", result.message);
      onPurchaseComplete();
    } catch (err) {
      setPromoLoading(false);
      Alert.alert("Invalid Code", (err as Error).message ?? "Could not redeem this code.");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Title */}
        {trigger && TRIGGER_MESSAGES[trigger] ? (
          <>
            <Text style={styles.title}>{TRIGGER_MESSAGES[trigger].title}</Text>
            <Text style={styles.subtitle}>{TRIGGER_MESSAGES[trigger].subtitle}</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Unlock your full potential</Text>
            <Text style={styles.subtitle}>No daily limits. No locked features. Just learn.</Text>
          </>
        )}

        {/* Free vs Pro comparison */}
        <View style={styles.comparisonTable}>
          <View style={styles.comparisonHeader}>
            <Text style={[styles.comparisonHeaderText, { flex: 1 }]}>Feature</Text>
            <Text style={[styles.comparisonHeaderText, styles.comparisonColCenter]}>Free</Text>
            <Text style={[styles.comparisonHeaderText, styles.comparisonColCenter, { color: colors.primary }]}>Pro</Text>
          </View>
          {COMPARISONS.map((row, i) => (
            <View
              key={row.feature}
              style={[styles.comparisonRow, i < COMPARISONS.length - 1 && styles.comparisonRowBorder]}
            >
              <Text style={[styles.comparisonFeature, { flex: 1 }]}>{row.feature}</Text>
              <Text style={[styles.comparisonFree, styles.comparisonColCenter]}>{row.free}</Text>
              <View style={[styles.comparisonColCenter, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={styles.comparisonPro}>{row.pro}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Plan options */}
        {loadingOfferings ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.offeringsLoader} />
        ) : (
          <View style={styles.planList}>
            {plans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              const isRecommended = plan.id === "annual";
              return (
                <AnimatedPressable
                  key={plan.id}
                  style={[
                    styles.planCard,
                    isRecommended && styles.planCardRecommended,
                    isSelected && styles.planCardSelected,
                  ]}
                  onPress={() => setSelectedPlan(plan.id)}
                  scaleDown={0.98}
                >
                  {plan.badge && (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{plan.badge}</Text>
                    </View>
                  )}
                  <View style={styles.planHeader}>
                    <View style={styles.planLabelRow}>
                      <View style={[styles.radio, isSelected && styles.radioSelected]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                      <View>
                        <Text style={[styles.planLabel, isSelected && styles.planLabelSelected]}>{plan.label}</Text>
                        {plan.perWeek && (
                          <Text style={styles.planPerWeek}>That's just {plan.perWeek} — save 55%</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.planPriceCol}>
                      <Text style={[styles.planPriceMain, isSelected && styles.planPriceSelected]}>{plan.priceText}</Text>
                      {plan.trialText && (
                        <Text style={styles.planTrialText}>{plan.trialText}</Text>
                      )}
                    </View>
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>
        )}

        {/* Trial highlight */}
        {selectedPlanOption?.trialText ? (
          <View style={styles.trialHighlight}>
            <Text style={styles.trialHighlightTitle}>Try free for 3 days</Text>
            <Text style={styles.trialHighlightSubtitle}>You won't be charged today</Text>
          </View>
        ) : (
          <Text style={styles.noCommitmentText}>Cancel anytime, no commitment</Text>
        )}

        {/* Subscribe button */}
        <View style={styles.subscribeWrap}>
          <AnimatedPressable
            onPress={handleSubscribe}
            disabled={purchasing || loadingOfferings}
            scaleDown={0.97}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.subscribeButton, (purchasing || loadingOfferings) && styles.subscribeButtonDisabled]}
            >
              {purchasing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.subscribeButtonText}>{ctaLabel}</Text>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </View>

        {/* Secondary actions */}
        <View style={styles.secondaryActions}>
          <TouchableOpacity onPress={handleRestore} disabled={purchasing} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Restore purchases</Text>
          </TouchableOpacity>

          <Text style={styles.secondaryDot}>{" \u00B7 "}</Text>

          <TouchableOpacity onPress={() => setPromoExpanded(!promoExpanded)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Promo code</Text>
          </TouchableOpacity>
        </View>

        {/* Promo code input */}
        {promoExpanded && (
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              placeholder="Enter code"
              placeholderTextColor={colors.textMuted}
              value={promoCode}
              onChangeText={setPromoCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={handleRedeemPromo}
              disabled={promoLoading || !promoCode.trim()}
              style={[styles.promoButton, (!promoCode.trim() || promoLoading) && { opacity: 0.5 }]}
            >
              {promoLoading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.promoButtonText}>Redeem</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Legal links */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalText}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>{" \u00B7 "}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

// ── Helpers ──

function buildPlans(annualPkg: PurchasesPackage | null, weeklyPkg: PurchasesPackage | null): PlanOption[] {
  return [
    {
      id: "annual",
      label: "Annual",
      badge: "Best Value — Save 55%",
      trialText: annualPkg?.product?.introPrice?.periodNumberOfUnits
        ? `${annualPkg.product.introPrice.periodNumberOfUnits}-day free trial`
        : "3-day free trial",
      priceText: annualPkg
        ? `${annualPkg.product.priceString}/year`
        : "$69.99/year",
      perWeek: "$1.35/week",
      pkg: annualPkg,
    },
    {
      id: "weekly",
      label: "Weekly",
      trialText: weeklyPkg?.product?.introPrice?.periodNumberOfUnits
        ? `${weeklyPkg.product.introPrice.periodNumberOfUnits}-day free trial`
        : "",
      priceText: weeklyPkg
        ? `${weeklyPkg.product.priceString}/week`
        : "$2.99/week",
      pkg: weeklyPkg,
    },
  ];
}

// ── Styles ──

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xxxl + 16,
    paddingBottom: spacing.xxxl,
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: spacing.xxxl,
    right: spacing.xxl,
    zIndex: 10,
    padding: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    lineHeight: 22,
  },

  // Comparison table
  comparisonTable: {
    alignSelf: "stretch",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: spacing.xl,
  },
  comparisonHeader: {
    flexDirection: "row",
    backgroundColor: colors.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  comparisonHeaderText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 12,
  },
  comparisonColCenter: {
    width: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  comparisonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  comparisonRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  comparisonFeature: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  comparisonFree: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  comparisonPro: {
    ...typography.caption,
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },

  // Trial highlight
  trialHighlight: {
    alignSelf: "stretch",
    backgroundColor: colors.primaryBg,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  trialHighlightTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 15,
  },
  trialHighlightSubtitle: {
    ...typography.caption,
    color: colors.primary,
    opacity: 0.7,
    marginTop: 2,
  },
  noCommitmentText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.lg,
  },

  // Plans
  offeringsLoader: {
    marginVertical: spacing.xxxl,
  },
  planList: {
    alignSelf: "stretch",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  planCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  planCardRecommended: {
    borderColor: colors.primary,
    ...shadows.sm,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  planLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  planLabel: {
    ...typography.bodyBold,
    color: colors.text,
  },
  planLabelSelected: {
    color: colors.primary,
  },
  planPerWeek: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "600",
    marginTop: 1,
  },
  planBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.success,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  planBadgeText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "700",
    fontSize: 11,
  },
  planPriceCol: {
    alignItems: "flex-end",
  },
  planPriceMain: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 15,
  },
  planPriceSelected: {
    color: colors.primary,
  },
  planTrialText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "600",
    marginTop: 2,
  },

  // Subscribe button
  subscribeWrap: {
    alignSelf: "stretch",
    ...shadows.md,
    borderRadius: radii.xl,
  },
  subscribeButton: {
    borderRadius: radii.xl,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    opacity: 0.6,
  },
  subscribeButtonText: {
    ...typography.button,
    color: colors.white,
    fontSize: 17,
    letterSpacing: 0.3,
  },

  // Secondary actions (restore + promo toggle)
  secondaryActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  secondaryText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 13,
  },
  secondaryDot: {
    ...typography.caption,
    color: colors.textMuted,
  },

  // Promo code
  promoRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  promoInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.text,
  },
  promoButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  promoButtonText: {
    ...typography.button,
    color: colors.white,
    fontSize: 14,
  },

  // Legal
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  legalText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  legalDot: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
