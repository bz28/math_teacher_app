// Join codes are short, case-insensitive, space-free tokens that teachers
// hand out. Normalize what a student types — uppercase, drop whitespace —
// before sending so "ab c12 " and "ABC12" hit the same section. Pure (no
// RN imports) so it's unit-testable.

export function normalizeJoinCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
