import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { PurchasesIntroPrice, PurchasesPackage } from "react-native-purchases";
import { AnimatedPressable } from "./AnimatedPressable";
import { Eyebrow } from "./Eyebrow";
import {
  getEligibleProductIds,
  getOfferings,
  purchasePackage,
  restorePurchases,
} from "../services/revenuecat";
import { useEntitlementStore } from "../stores/entitlements";
import { LEGAL_URLS } from "../constants/legal";
import { useColors, useGradients, spacing, radii, typography, type ColorPalette } from "../theme";

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
  ctaTrialLabel: string;
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

/**
 * Hero copy used when we can't (or don't want to) show the free-trial
 * framing — typically the user has already redeemed their trial, so
 * pitching "3 days free" would be a lie.
 */
const TRIGGER_MESSAGES_NO_TRIAL: Record<string, { title: string; subtitle: string }> = {
  create_session: {
    title: "You've hit your 24-hour limit",
    subtitle: "Upgrade for unlimited problem sessions",
  },
  image_scan: {
    title: "You've hit your 24-hour limit",
    subtitle: "Upgrade for unlimited image scans",
  },
  chat_message: {
    title: "You've hit your 24-hour limit",
    subtitle: "Upgrade for unlimited chat messages",
  },
  work_diagnosis: {
    title: "Pro Feature",
    subtitle: "Get AI-powered grading on your work",
  },
};

/** Triggers where, if the user is eligible for the annual trial, we
 *  override the hero copy with the trial-first framing. Post-signup
 *  always uses the trial framing when eligible. */
const LIMIT_TRIGGERS = new Set(["create_session", "image_scan", "chat_message"]);

export function PaywallScreen({ visible, onClose, onPurchaseComplete, trigger }: PaywallProps) {
  const colors = useColors();
  const gradients = useGradients();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("annual");
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => {
    if (!visible) return;
    setLoadingOfferings(true);
    setSelectedPlan("annual");

    // Retry getOfferings with backoff — RevenueCat may not be configured
    // yet on the very first paywall open right after register, and a
    // single-shot failure here silently strips the trial pitch. Mirrors
    // the retry strategy in useTrialEligibility.ts.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delays = [0, 600, 1500, 3500];
    let attempt = 0;

    const tryLoad = () => {
      getOfferings()
        .then(async (offerings) => {
          if (cancelled) return;
          const current = offerings.current;
          const annualPkg = current?.annual ?? null;
          const weeklyPkg = current?.weekly ?? null;
          const productIds = [annualPkg?.product.identifier, weeklyPkg?.product.identifier]
            .filter((id): id is string => !!id);
          let eligibleProductIds: Set<string>;
          try {
            eligibleProductIds = await getEligibleProductIds(productIds);
          } catch {
            // Defensive: never advertise a trial we can't verify the user gets.
            eligibleProductIds = new Set();
          }
          if (cancelled) return;
          setPlans(buildPlans(annualPkg, weeklyPkg, eligibleProductIds));
          setLoadingOfferings(false);
        })
        .catch(() => {
          attempt += 1;
          if (cancelled) return;
          if (attempt >= delays.length) {
            setPlans(buildPlans(null, null, new Set()));
            setLoadingOfferings(false);
            return;
          }
          timer = setTimeout(tryLoad, delays[attempt]);
        });
    };

    tryLoad();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [visible]);

  const selectedPlanOption = plans.find((p) => p.id === selectedPlan);
  const annualPlanOption = plans.find((p) => p.id === "annual");

  // While offerings are loading we don't yet know eligibility — default
  // to assuming the user can claim the trial so we don't show a colder
  // "you've hit your limit" message and then flip to the trial pitch a
  // moment later. Once loaded, we go strictly by what RevenueCat says.
  const annualTrialEligible = loadingOfferings ? true : !!annualPlanOption?.trialText;

  // Trial-first framing applies on post-signup and limit-hit triggers,
  // but ONLY when the user can actually redeem the annual trial — otherwise
  // hero ("Start your free trial") and CTA ("Subscribe Now $79.99") fall
  // out of sync because the CTA copy is driven by real product data.
  const showTrialFraming =
    annualTrialEligible &&
    (trigger === "post_signup" ||
      (trigger !== undefined && LIMIT_TRIGGERS.has(trigger)));

  let heroTitle: string;
  let heroSubtitle: string;
  if (showTrialFraming) {
    heroTitle = "Start your free trial";
    heroSubtitle = annualPlanOption?.trialText && annualPlanOption?.priceText
      ? `${annualPlanOption.trialText}, then ${annualPlanOption.priceText} — annual only, first-time subscribers`
      : "3 days free, then annual — first-time subscribers only";
  } else if (trigger && TRIGGER_MESSAGES_NO_TRIAL[trigger]) {
    heroTitle = TRIGGER_MESSAGES_NO_TRIAL[trigger].title;
    heroSubtitle = TRIGGER_MESSAGES_NO_TRIAL[trigger].subtitle;
  } else {
    heroTitle = "Unlock Veradic AI Pro";
    heroSubtitle = "No limits. No restrictions. Just learn.";
  }

  // CTA copy. Tied directly to `showTrialFraming` (not `trialText`) so the
  // hero and CTA always agree — including the loading window where we've
  // assumed eligibility but offerings haven't returned yet.
  const isAnnualSelected = selectedPlan === "annual";
  const ctaLabel = showTrialFraming && isAnnualSelected
    ? "Start Free Trial"
    : selectedPlanOption?.ctaTrialLabel || "Subscribe Now";
  const ctaSublabel = selectedPlanOption?.trialText
    ? `3 days free, then ${selectedPlanOption.priceText}`
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero header — serif editorial moment over signature gradient */}
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>

          <Eyebrow tone="invert" style={styles.heroEyebrow}>Veradic Pro</Eyebrow>
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
        </LinearGradient>

        {/* Features */}
        <View style={styles.featureSection}>
          <Eyebrow style={styles.featureSectionTitle}>Everything in Pro</Eyebrow>
          {FEATURES.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Ionicons name="checkmark" size={18} color={colors.primary} />
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
                            <Text style={styles.saveInlineText}>Save 49%</Text>
                          </View>
                        )}
                      </View>
                      {plan.trialText ? (
                        // Annual with trial — emphasize, since this is the
                        // one and only place users see a free trial offered.
                        <Text style={[styles.planTrialSub, isSelected && styles.planTrialSubSelected]}>
                          ✨ {plan.trialText}
                        </Text>
                      ) : !isAnnual && annualTrialEligible ? (
                        // Weekly card while annual trial is on the table —
                        // be explicit so nobody assumes weekly is also free.
                        <Text style={[styles.planSub, isSelected && styles.planSubSelected]}>
                          No free trial — bills weekly
                        </Text>
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

        {/* Auto-renewal disclosure (Apple Guideline 3.1.2). Uses trialText
            verbatim so we don't assume day/week/month unit or singular/plural. */}
        {!loadingOfferings && selectedPlanOption && (
          <Text style={styles.renewalDisclosure}>
            {selectedPlanOption.trialText
              ? `${selectedPlanOption.trialText}, then ${selectedPlanOption.priceText}. `
              : `${selectedPlanOption.priceText}. `}
            Subscription auto-renews unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your App Store account settings.
          </Text>
        )}

        {/* Continue free — explicit dismiss for the post-signup and
            limit-hit flows where users need a clear "no thanks" path
            beyond the small × in the corner. */}
        <TouchableOpacity onPress={onClose} disabled={purchasing} style={styles.continueFreeButton}>
          <Text style={styles.continueFreeText}>Continue with free version</Text>
        </TouchableOpacity>

        {/* Secondary actions */}
        <View style={styles.secondaryActions}>
          <TouchableOpacity onPress={handleRestore} disabled={purchasing} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Restore purchases</Text>
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
            <Text style={styles.legalText}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>{" · "}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
            <Text style={styles.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

// ── Helpers ──

function buildPlans(
  annualPkg: PurchasesPackage | null,
  weeklyPkg: PurchasesPackage | null,
  eligibleProductIds: Set<string>,
): PlanOption[] {
  const annualIntro = formatIntroOffer(
    annualPkg && eligibleProductIds.has(annualPkg.product.identifier)
      ? annualPkg.product.introPrice
      : null,
  );
  const weeklyIntro = formatIntroOffer(
    weeklyPkg && eligibleProductIds.has(weeklyPkg.product.identifier)
      ? weeklyPkg.product.introPrice
      : null,
  );
  return [
    {
      id: "annual",
      label: "Annual",
      trialText: annualIntro.trialText,
      ctaTrialLabel: annualIntro.ctaTrialLabel,
      priceText: annualPkg
        ? `${annualPkg.product.priceString}/yr`
        : "$79.99/yr",
      perWeek: "$1.54/wk",
      pkg: annualPkg,
    },
    {
      id: "weekly",
      label: "Weekly",
      trialText: weeklyIntro.trialText,
      ctaTrialLabel: weeklyIntro.ctaTrialLabel,
      priceText: weeklyPkg
        ? `${weeklyPkg.product.priceString}/wk`
        : "$2.99/wk",
      pkg: weeklyPkg,
    },
  ];
}

// Derives trial copy from the introductory offer payload. Callers must pass
// `null` when the user is not eligible — buildPlans handles that gating using
// Purchases.checkTrialOrIntroductoryPriceEligibility. The helper itself only
// covers the "no intro configured" case (Apple Guideline 2.1(b)).
function formatIntroOffer(intro: PurchasesIntroPrice | null | undefined): {
  trialText: string;
  ctaTrialLabel: string;
} {
  const n = intro?.periodNumberOfUnits;
  const unit = intro?.periodUnit;
  if (!n || !unit) return { trialText: "", ctaTrialLabel: "" };
  const lowerUnit = unit.toLowerCase();
  const titleUnit = lowerUnit.charAt(0).toUpperCase() + lowerUnit.slice(1);
  const plural = n === 1 ? "" : "s";
  return {
    trialText: `${n}-${lowerUnit} free trial`,
    ctaTrialLabel: `Try ${n} ${titleUnit}${plural} Free`,
  };
}

// ── Styles ──


const makeStyles = (colors: ColorPalette) => StyleSheet.create({
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
    paddingTop: spacing.xxxl + 28,
    paddingBottom: spacing.xxl + spacing.sm,
    paddingHorizontal: spacing.xxl,
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: spacing.xxxl + 4,
    right: spacing.lg,
    zIndex: 10,
    padding: spacing.xs,
  },
  heroEyebrow: {
    marginBottom: spacing.md,
    opacity: 0.85,
  },
  heroTitle: {
    ...typography.displaySerifItalic,
    color: colors.white,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...typography.body,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
  },

  // Features
  featureSection: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  featureSectionTitle: {
    marginBottom: spacing.md,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
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
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  planCardSelected: {
    borderColor: colors.primary,
    borderWidth: 1.5,
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
  planTrialSub: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "700",
    fontSize: 12,
    marginTop: 3,
  },
  planTrialSubSelected: {
    color: colors.success,
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
  },
  ctaButton: {
    borderRadius: radii.md,
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
  renewalDisclosure: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.sm,
  },

  // Continue with free version (explicit dismiss CTA)
  continueFreeButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  continueFreeText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
  },

  // Secondary
  secondaryActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
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
