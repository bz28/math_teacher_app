import { Platform } from "react-native";
import Purchases, {
  type PurchasesOfferings,
  type PurchasesPackage,
  type CustomerInfo,
} from "react-native-purchases";

const REVENUECAT_IOS_KEY = "test_EARIAgUMbdOpwbkzpSUsbgREBus";
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
 * Fetch available subscription offerings (monthly + annual packages).
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
