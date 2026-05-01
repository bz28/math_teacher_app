import { Platform } from "react-native";
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  type PurchasesOfferings,
  type PurchasesPackage,
  type CustomerInfo,
} from "react-native-purchases";

const REVENUECAT_IOS_KEY = "appl_eWnxtAHCMBerWjeemxhxlVcCdFu";
const REVENUECAT_ANDROID_KEY = "goog_XXXXXXXX"; // TODO: set real Android API key

/**
 * Initialise RevenueCat SDK. Call once after the user authenticates.
 * Skips initialisation when API keys are still placeholders (dev mode).
 */
export async function initRevenueCat(userId: string): Promise<void> {
  const apiKey = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (apiKey.includes("XXXXXXXX") || !apiKey) {
    if (__DEV__) console.warn("[RevenueCat] Skipping init — API key is a placeholder");
    return;
  }
  Purchases.configure({ apiKey, appUserID: userId });
}

/**
 * Fetch available subscription offerings (weekly + annual packages).
 */
export async function getOfferings(): Promise<PurchasesOfferings> {
  return Purchases.getOfferings();
}

/**
 * Purchase a specific package. Returns the updated CustomerInfo on success.
 * Resolves to `null` when the user cancels — callers should treat this as a
 * no-op rather than an error.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (err: unknown) {
    // RevenueCat uses `userCancelled` flag for user-initiated cancellations
    if (err && typeof err === "object" && "userCancelled" in err && (err as { userCancelled: boolean }).userCancelled) {
      return null;
    }
    throw err;
  }
}

/**
 * Restore previous purchases (e.g. after reinstall or switching devices).
 */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/**
 * Returns the subset of product IDs the current Apple ID / Play account is
 * actually eligible to redeem an introductory offer (free trial) for.
 *
 * Critical: a product having `introPrice` populated does NOT mean *this user*
 * gets it — Apple/Google ship offer metadata on every SKProduct regardless of
 * eligibility. Without this check, the paywall promises a trial that the
 * StoreKit payment sheet won't honor (App Store Guideline 2.1(b)).
 *
 * UNKNOWN status is treated as not-eligible so we never over-promise.
 */
export async function getEligibleProductIds(productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
  const eligible = new Set<string>();
  for (const [id, info] of Object.entries(result)) {
    if (info.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
      eligible.add(id);
    }
  }
  return eligible;
}
