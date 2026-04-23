// Public URLs served by the Next.js app at web/src/app/(legal)/*.
// Duplicated across PaywallScreen and AccountScreen before this constants
// file existed; kept here so the domain only changes in one place.
export const LEGAL_URLS = {
  privacy: "https://veradicai.com/privacy",
  terms: "https://veradicai.com/terms",
  support: "https://veradicai.com/support",
} as const;
