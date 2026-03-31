import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { PurchasesPackage } from "react-native-purchases";
import { AnimatedPressable } from "./AnimatedPressable";
import { getOfferings, purchasePackage, restorePurchases } from "../services/revenuecat";
import { useEntitlementStore } from "../stores/entitlements";
import { colors, spacing, radii, typography, shadows, gradients } from "../theme";

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onPurchaseComplete: () => void;
  trigger?: string;
}

type PlanId = "annual" | "monthly";

interface PlanOption {
  id: PlanId;
  label: string;
  badge?: string;
  trialText: string;
  priceText: string;
  pkg: PurchasesPackage | null;
}

const FEATURES = [
  "Unlimited problems per day",
  "Work photo diagnosis",
  "Priority support",
];

const TERMS_URL = "https://veradic.ai/terms";
const PRIVACY_URL = "https://veradic.ai/privacy";

export function PaywallScreen({ visible, onClose, onPurchaseComplete, trigger }: PaywallProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("annual");
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const fetchEntitlements = useEntitlementStore((s) => s.fetchEntitlements);

  useEffect(() => {
    if (!visible) return;
    setLoadingOfferings(true);
    setSelectedPlan("annual");

    getOfferings()
      .then((offerings) => {
        const current = offerings.current;
        const annualPkg = current?.annual ?? null;
        const monthlyPkg = current?.monthly ?? null;

        setPlans([
          {
            id: "annual",
            label: "Annual",
            badge: "Save 50%",
            trialText: annualPkg?.product?.introPrice?.periodNumberOfUnits
              ? `${annualPkg.product.introPrice.periodNumberOfUnits}-day free trial`
              : "7-day free trial",
            priceText: annualPkg
              ? `then ${annualPkg.product.priceString}/year`
              : "then $59.99/year",
            pkg: annualPkg,
          },
          {
            id: "monthly",
            label: "Monthly",
            trialText: monthlyPkg?.product?.introPrice?.periodNumberOfUnits
              ? `${monthlyPkg.product.introPrice.periodNumberOfUnits}-day free trial`
              : "7-day free trial",
            priceText: monthlyPkg
              ? `then ${monthlyPkg.product.priceString}/month`
              : "then $9.99/month",
            pkg: monthlyPkg,
          },
        ]);
      })
      .catch(() => {
        // Use hardcoded fallback
        setPlans([
          {
            id: "annual",
            label: "Annual",
            badge: "Save 50%",
            trialText: "7-day free trial",
            priceText: "then $59.99/year",
            pkg: null,
          },
          {
            id: "monthly",
            label: "Monthly",
            trialText: "7-day free trial",
            priceText: "then $9.99/month",
            pkg: null,
          },
        ]);
      })
      .finally(() => setLoadingOfferings(false));
  }, [visible]);

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
        // User cancelled — just dismiss loading
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
      <View style={styles.container}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Title */}
        <Text style={styles.title}>Unlock Veradic AI Pro</Text>

        {/* Features */}
        <View style={styles.featureList}>
          {FEATURES.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={styles.featureText}>{feature}</Text>
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
              return (
                <AnimatedPressable
                  key={plan.id}
                  style={[
                    styles.planCard,
                    shadows.sm,
                    isSelected && styles.planCardSelected,
                  ]}
                  onPress={() => setSelectedPlan(plan.id)}
                  scaleDown={0.98}
                >
                  <View style={styles.planHeader}>
                    <View style={styles.planLabelRow}>
                      <View style={[styles.radio, isSelected && styles.radioSelected]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                      <Text style={[styles.planLabel, isSelected && styles.planLabelSelected]}>{plan.label}</Text>
                    </View>
                    {plan.badge && (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeText}>{plan.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.planTrial}>{plan.trialText}</Text>
                  <Text style={styles.planPrice}>{plan.priceText}</Text>
                </AnimatedPressable>
              );
            })}
          </View>
        )}

        {/* Subscribe button */}
        <AnimatedPressable
          onPress={handleSubscribe}
          disabled={purchasing || loadingOfferings}
          scaleDown={0.97}
          style={{ width: "100%" }}
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
              <Text style={styles.subscribeButtonText}>Subscribe</Text>
            )}
          </LinearGradient>
        </AnimatedPressable>

        {/* Restore */}
        <TouchableOpacity onPress={handleRestore} disabled={purchasing} style={styles.restoreButton}>
          <Text style={styles.restoreText}>Restore purchases</Text>
        </TouchableOpacity>

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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xxl + 4,
    paddingTop: spacing.xxxl + 16,
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
    marginBottom: spacing.xxl,
  },

  // Features
  featureList: {
    alignSelf: "stretch",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  featureText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },

  // Plans
  offeringsLoader: {
    marginVertical: spacing.xxxl,
  },
  planList: {
    alignSelf: "stretch",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  planCard: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
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
  planBadge: {
    backgroundColor: colors.success,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  planBadgeText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "700",
    fontSize: 11,
  },
  planTrial: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: 28,
  },
  planPrice: {
    ...typography.caption,
    color: colors.textMuted,
    marginLeft: 28,
    marginTop: 2,
  },

  // Subscribe button
  subscribeButton: {
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    opacity: 0.6,
  },
  subscribeButtonText: {
    ...typography.button,
    color: colors.white,
  },

  // Restore
  restoreButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  restoreText: {
    ...typography.bodyBold,
    color: colors.primary,
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
