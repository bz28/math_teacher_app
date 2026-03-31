/** Safely extract an error message from an unknown catch value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "An unexpected error occurred";
}
