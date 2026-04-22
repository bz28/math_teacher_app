import * as StoreReview from "expo-store-review";

// Apple caps StoreReview.requestReview to 3 prompts per 365 days per user
// at the OS level, and we only trigger it once per install regardless
// (gated by hasRequestedReview in onboardingFlags). This keeps us well
// under Apple's guidelines and avoids annoying retained users who declined.
export async function askForReviewIfAvailable(): Promise<void> {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    await StoreReview.requestReview();
  } catch {
    // Never throw — rating prompts are fire-and-forget. If the iOS
    // dialog fails to present for any reason, the user's experience
    // continues uninterrupted.
  }
}
