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
 *
 * In Expo Go the `react-native-purchases` native module isn't bundled, so
 * `Purchases.configure` either no-ops or throws "no singleton instance" on
 * later calls. We swallow that here and let each consumer method below
 * fall back to its dev stub. Real builds always succeed.
 */
export async function initRevenueCat(userId: string): Promise<void> {
  const apiKey = Platform.OS === "ios" ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (apiKey.includes("XXXXXXXX") || !apiKey) {
    if (__DEV__) console.warn("[RevenueCat] Skipping init — API key is a placeholder");
    return;
  }
  try {
    Purchases.configure({ apiKey, appUserID: userId });
  } catch (err) {
    if (__DEV__) console.warn("[RevenueCat] configure failed — likely Expo Go without native module, will use dev stubs:", err);
  }
}

/**
 * Fetch available subscription offerings (weekly + annual packages).
 */
export async function getOfferings(): Promise<PurchasesOfferings> {
  try {
    return await Purchases.getOfferings();
  } catch (err) {
    if (__DEV__) {
      console.warn("[RevenueCat] getOfferings unavailable — returning dev stub:", err);
      return makeDevOfferings();
    }
    throw err;
  }
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
    if (__DEV__) {
      console.warn("[RevenueCat] purchasePackage unavailable — simulating cancel for dev:", err);
      return null;
    }
    throw err;
  }
}

/**
 * Restore previous purchases (e.g. after reinstall or switching devices).
 */
export async function restorePurchases(): Promise<CustomerInfo> {
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    if (__DEV__) {
      console.warn("[RevenueCat] restorePurchases unavailable — returning empty dev CustomerInfo:", err);
      return makeDevCustomerInfo();
    }
    throw err;
  }
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
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    const eligible = new Set<string>();
    for (const [id, info] of Object.entries(result)) {
      if (info.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
        eligible.add(id);
      }
    }
    return eligible;
  } catch (err) {
    if (__DEV__) {
      console.warn("[RevenueCat] eligibility check unavailable — marking all products eligible for dev:", err);
      return new Set(productIds);
    }
    throw err;
  }
}

// ── Dev stubs ──
//
// Reachable only in __DEV__ when the native `react-native-purchases` module
// isn't loaded (Expo Go). Production builds always hit the real SDK above and
// never fall through to these. The shape is the minimum that PaywallScreen +
// useTrialEligibility actually read — cast through `unknown` because we don't
// implement the full RC type surface.

function makeDevOfferings(): PurchasesOfferings {
  const annual = makeDevPackage("annual_dev_stub", 79.99, "$79.99", {
    periodNumberOfUnits: 3,
    periodUnit: "DAY",
    priceString: "$0.00",
    price: 0,
    cycles: 1,
  });
  const weekly = makeDevPackage("weekly_dev_stub", 2.99, "$2.99", null);
  const current = {
    identifier: "default_dev_stub",
    serverDescription: "Dev stub offering",
    metadata: {},
    annual,
    weekly,
    availablePackages: [annual, weekly],
  };
  return {
    current,
    all: { [current.identifier]: current },
  } as unknown as PurchasesOfferings;
}

function makeDevPackage(
  productId: string,
  price: number,
  priceString: string,
  introPrice: unknown,
): PurchasesPackage {
  return {
    identifier: productId,
    packageType: productId.startsWith("annual") ? "ANNUAL" : "WEEKLY",
    product: {
      identifier: productId,
      title: productId,
      description: "Dev stub product",
      price,
      priceString,
      currencyCode: "USD",
      introPrice,
    },
  } as unknown as PurchasesPackage;
}

function makeDevCustomerInfo(): CustomerInfo {
  return {
    entitlements: { active: {}, all: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
  } as unknown as CustomerInfo;
}
