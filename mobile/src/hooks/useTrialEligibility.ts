import { useEffect, useState } from "react";
import { getEligibleProductIds, getOfferings } from "../services/revenuecat";
import { useEntitlementStore } from "../stores/entitlements";

/**
 * Whether the current Apple ID can still redeem the free trial on
 * one of our subscription products. Cached at module level so each
 * surface that wants to advertise the trial (Home upgrade card,
 * Account upgrade button, ModeSelect inline link) doesn't re-hit
 * StoreKit on mount. Pro users always read `false` because the
 * question is moot for them.
 *
 * Defaults to false until StoreKit confirms eligibility — never
 * over-promise a trial we can't deliver (Apple Guideline 2.1(b)).
 *
 * Why distinguish "real false" from "probe error":
 *   - Real false: getOfferings + getEligibleProductIds completed,
 *     RC reports the user has already used a trial (or no SKUs
 *     have an intro offer). Result is a hard `false`.
 *   - Probe error: getOfferings threw — typically because RC's
 *     native module isn't ready yet or there's a transient network
 *     blip. We retry instead of caching `false`, since the user
 *     may genuinely be eligible.
 */

let cachedEligible: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

class ProbeError extends Error {}

async function probeEligibility(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const offerings = await getOfferings();
      const productIds = [
        offerings.current?.annual?.product.identifier,
        offerings.current?.weekly?.product.identifier,
      ].filter((id): id is string => !!id);
      if (productIds.length === 0) {
        if (__DEV__) console.warn("[trial-eligibility] no subscription products in current offering — treating as not eligible");
        cachedEligible = false;
        return false;
      }
      const eligible = await getEligibleProductIds(productIds);
      const result = eligible.size > 0;
      if (__DEV__) {
        console.warn(
          `[trial-eligibility] StoreKit says eligible=${result} for products [${productIds.join(", ")}]`,
        );
      }
      cachedEligible = result;
      return result;
    } catch (err) {
      if (__DEV__) console.warn("[trial-eligibility] probe failed (will retry):", err);
      // Don't cache failures — RC may not be initialized yet.
      throw new ProbeError(String(err));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useTrialEligibility(): boolean {
  const isPro = useEntitlementStore((s) => s.isPro);
  const [eligible, setEligible] = useState<boolean>(cachedEligible ?? false);

  useEffect(() => {
    if (isPro) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Try immediately, then back off if RC isn't ready yet. Cap at
    // ~6s total wait so we don't churn forever on a permanently
    // broken setup.
    const delays = [0, 600, 1500, 3500];
    let attempt = 0;

    const tryProbe = () => {
      probeEligibility()
        .then((result) => {
          if (!cancelled) setEligible(result);
        })
        .catch(() => {
          attempt += 1;
          if (cancelled || attempt >= delays.length) return;
          timer = setTimeout(tryProbe, delays[attempt]);
        });
    };

    tryProbe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isPro]);

  return eligible;
}

/** Call after a successful purchase / restore so the cache reflects
 *  that the user has now consumed (or wasn't entitled to) the trial. */
export function clearTrialEligibilityCache() {
  cachedEligible = null;
}
