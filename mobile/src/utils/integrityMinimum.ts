// Typed-reply minimums for the understanding-check chat — a mirror of the
// rule the /turn endpoint enforces (api/routes/integrity_check.py). The
// server is the authority; this keeps Send disabled and the hint honest so
// a student never hits a 400 for something the UI let them try.

/** Plain floor on every typed reply — stops empty / "x" sends. */
export const MIN_INTEGRITY_MESSAGE_CHARS = 5;
/** Once the one "I'm stuck" tap is spent, a typed reply must be "a few
 *  words": this many words OR MIN_CHARS_AFTER_STUCK characters. Either bar
 *  is enough, so an honest short answer ("x = 4") still sends. */
const MIN_WORDS_AFTER_STUCK = 3;
const MIN_CHARS_AFTER_STUCK = 12;

/** Whether a typed reply can be sent, given whether the stuck tap is used. */
export function meetsIntegrityMinimum(message: string, stuckUsed: boolean): boolean {
  const text = message.trim();
  if (text.length < MIN_INTEGRITY_MESSAGE_CHARS) return false;
  if (!stuckUsed) return true;
  return text.split(/\s+/).length >= MIN_WORDS_AFTER_STUCK || text.length >= MIN_CHARS_AFTER_STUCK;
}
