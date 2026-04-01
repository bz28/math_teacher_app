/**
 * RevenueCat Web SDK wrapper.
 *
 * Two separate RC apps exist (weekly + annual) with different API keys,
 * so we configure the SDK with the correct key before each purchase.
 */

import { ErrorCode, Purchases, PurchasesError } from "@revenuecat/purchases-js";

const RC_WEEKLY_KEY = process.env.NEXT_PUBLIC_RC_WEEKLY_KEY ?? "";
const RC_ANNUAL_KEY = process.env.NEXT_PUBLIC_RC_ANNUAL_KEY ?? "";

export type PlanType = "weekly" | "annual";

function getApiKey(plan: PlanType): string {
  return plan === "weekly" ? RC_WEEKLY_KEY : RC_ANNUAL_KEY;
}

/**
 * Configure the RC SDK for a specific plan and return the instance.
 * Must be called before purchase — uses the correct API key per plan.
 */
function configureForPlan(plan: PlanType, userId: string): Purchases {
  const apiKey = getApiKey(plan);
  if (!apiKey) {
    throw new Error(`RevenueCat ${plan} API key is not configured`);
  }
  return Purchases.configure({ apiKey, appUserId: userId });
}

/**
 * Start a purchase flow for the given plan.
 * Configures RC with the correct key, fetches the offering, and triggers checkout.
 * Returns true on success, false if the user cancelled.
 */
export async function purchasePlan(
  plan: PlanType,
  userId: string,
  email: string,
): Promise<boolean> {
  const rc = configureForPlan(plan, userId);
  const offerings = await rc.getOfferings();
  const current = offerings.current;

  if (!current || current.availablePackages.length === 0) {
    throw new Error("No offerings available");
  }

  // Each RC app has one product, so grab the first available package
  const pkg = current.availablePackages[0];

  try {
    await rc.purchase({ rcPackage: pkg, customerEmail: email });
    return true;
  } catch (err) {
    if (err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError) {
      return false;
    }
    throw err;
  }
}

/**
 * Get the Stripe customer portal URL for managing an existing subscription.
 * Tries both keys since the subscription could be on either RC app.
 */
export async function getManagementUrl(userId: string): Promise<string | null> {
  for (const plan of ["weekly", "annual"] as PlanType[]) {
    const apiKey = getApiKey(plan);
    if (!apiKey) continue;

    try {
      const rc = Purchases.configure({ apiKey, appUserId: userId });
      const info = await rc.getCustomerInfo();
      if (info.managementURL) {
        return info.managementURL;
      }
    } catch {
      // Try next key
    }
  }
  return null;
}
