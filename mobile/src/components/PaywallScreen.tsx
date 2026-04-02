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
  trialText: string;
  priceText: string;
  perWeek?: string;
  pkg: PurchasesPackage | null;
}

const FEATURES = [
  "Unlimited problem sessions",
  "Unlimited chat messages",
  "Unlimited image scanning",
  "AI-powered work diagnosis",
  "Full session history",
];

const TRIGGER_MESSAGES: Record<string, { title: string; subtitle: string }> = {
  create_session: {
    title: "You've hit today's limit",
    subtitle: "Upgrade for unlimited problem sessions",
  },
  image_scan: {
    title: "You've hit today's limit",
    subtitle: "Upgrade for unlimited image scans",
  },
  chat_message: {
    title: "You've hit today's limit",
    subtitle: "Upgrade for unlimited chat messages",
  },
  work_diagnosis: {
    title: "Pro Feature",
    subtitle: "Get AI-powered grading on your work",
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
    ? "Try 3 Days Free"
    : "Subscribe Now";
  const ctaSublabel = selectedPlanOption?.trialText
    ? `then ${selectedPlanOption.priceText}`
    : selectedPlanOption?.priceText ?? "";

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
        {/* Hero header */}
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          <View style={styles.iconCircle}>
            <Ionicons name="diamond" size={32} color={colors.primary} />
          </View>

          {trigger && TRIGGER_MESSAGES[trigger] ? (
            <>
              <Text style={styles.heroTitle}>{TRIGGER_MESSAGES[trigger].title}</Text>
              <Text style={styles.heroSubtitle}>{TRIGGER_MESSAGES[trigger].subtitle}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>Unlock Veradic AI Pro</Text>
              <Text style={styles.heroSubtitle}>No limits. No restrictions. Just learn.</Text>
            </>
          )}
        </LinearGradient>

        {/* Features */}
        <View style={styles.featureSection}>
          <Text style={styles.featureSectionTitle}>Everything in Pro</Text>
          {FEATURES.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* Plan selector */}
        {loadingOfferings ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.offeringsLoader} />
        ) : (
          <View style={styles.planList}>
            {plans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              const isAnnual = plan.id === "annual";
              return (
                <AnimatedPressable
                  key={plan.id}
                  style={[styles.planCard, isSelected && styles.planCardSelected]}
                  onPress={() => setSelectedPlan(plan.id)}
                  scaleDown={0.98}
                >
                  {isAnnual && (
                    <View style={styles.saveBadge}>
                      <Text style={styles.saveBadgeText}>BEST VALUE</Text>
                    </View>
                  )}
                  <View style={styles.planLeft}>
                    <View style={[styles.radio, isSelected && styles.radioSelected]}>
                      {isSelected && <View style={styles.radioInner} />}
                    </View>
                    <View>
                      <View style={styles.planLabelRow}>
                        <Text style={[styles.planLabel, isSelected && styles.planLabelSelected]}>{plan.label}</Text>
                        {isAnnual && (
                          <View style={styles.saveInline}>
                            <Text style={styles.saveInlineText}>Save 55%</Text>
                          </View>
                        )}
                      </View>
                      {plan.trialText ? (
                        <Text style={[styles.planSub, isSelected && styles.planSubSelected]}>{plan.trialText}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.planRight}>
                    <Text style={[styles.planPrice, isSelected && styles.planPriceSelected]}>{plan.priceText}</Text>
                    {plan.perWeek && (
                      <Text style={[styles.planPerWeek, isSelected && styles.planPerWeekSelected]}>{plan.perWeek}</Text>
                    )}
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>
        )}

        {/* CTA */}
        <View style={styles.ctaWrap}>
          <AnimatedPressable
            onPress={handleSubscribe}
            disabled={purchasing || loadingOfferings}
            scaleDown={0.97}
          >
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.ctaButton, (purchasing || loadingOfferings) && styles.ctaButtonDisabled]}
            >
              {purchasing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Text style={styles.ctaButtonText}>{ctaLabel}</Text>
                  {ctaSublabel ? <Text style={styles.ctaSublabel}>{ctaSublabel}</Text> : null}
                </>
              )}
            </LinearGradient>
          </AnimatedPressable>
        </View>

        {selectedPlanOption?.trialText && (
          <Text style={styles.noChargeNote}>You won't be charged today</Text>
        )}

        {/* Secondary actions */}
        <View style={styles.secondaryActions}>
          <TouchableOpacity onPress={handleRestore} disabled={purchasing} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Restore purchases</Text>
          </TouchableOpacity>
          <Text style={styles.secondaryDot}>{" · "}</Text>
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

        {/* Legal */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalText}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>{" · "}</Text>
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
      trialText: annualPkg?.product?.introPrice?.periodNumberOfUnits
        ? `${annualPkg.product.introPrice.periodNumberOfUnits}-day free trial`
        : "3-day free trial",
      priceText: annualPkg
        ? `${annualPkg.product.priceString}/yr`
        : "$69.99/yr",
      perWeek: "$1.35/wk",
      pkg: annualPkg,
    },
    {
      id: "weekly",
      label: "Weekly",
      trialText: weeklyPkg?.product?.introPrice?.periodNumberOfUnits
        ? `${weeklyPkg.product.introPrice.periodNumberOfUnits}-day free trial`
        : "",
      priceText: weeklyPkg
        ? `${weeklyPkg.product.priceString}/wk`
        : "$2.99/wk",
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
    alignItems: "center",
    paddingBottom: spacing.xxxl,
  },

  // Hero
  hero: {
    width: "100%",
    paddingTop: spacing.xxxl + 20,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    alignItems: "center",
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  closeButton: {
    position: "absolute",
    top: spacing.xxxl + 4,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.xs,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.white,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  heroTitle: {
    ...typography.title,
    color: colors.white,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    ...typography.body,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    fontSize: 15,
  },

  // Features
  featureSection: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  featureSectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  featureText: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
  },

  // Plans
  offeringsLoader: {
    marginVertical: spacing.xxxl,
  },
  planList: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm + 2,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  saveBadge: {
    position: "absolute",
    top: -10,
    right: spacing.lg,
    backgroundColor: colors.success,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
  },
  saveBadgeText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  planLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  planLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  planLabel: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 16,
  },
  planLabelSelected: {
    color: colors.primary,
  },
  saveInline: {
    backgroundColor: colors.successLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  saveInlineText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "700",
    fontSize: 10,
  },
  planSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  planSubSelected: {
    color: colors.primary,
    opacity: 0.8,
  },
  planRight: {
    alignItems: "flex-end",
  },
  planPrice: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 16,
  },
  planPriceSelected: {
    color: colors.primary,
  },
  planPerWeek: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  planPerWeekSelected: {
    color: colors.primary,
    opacity: 0.8,
  },

  // CTA
  ctaWrap: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
    ...shadows.md,
    borderRadius: radii.xl,
  },
  ctaButton: {
    borderRadius: radii.xl,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaButtonText: {
    ...typography.button,
    color: colors.white,
    fontSize: 17,
    letterSpacing: 0.3,
  },
  ctaSublabel: {
    ...typography.caption,
    color: "rgba(255,255,255,0.75)",
    marginTop: 2,
    fontSize: 12,
  },
  noChargeNote: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "600",
    marginTop: spacing.sm,
    textAlign: "center",
  },

  // Secondary
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

  // Promo
  promoRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
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
