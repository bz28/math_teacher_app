// Client mirror of the typed-reply rules the integrity /turn endpoint
// enforces. The server is the authority; this keeps Send disabled and the
// hint honest so a student never hits a 400 for something the UI let them
// try. The don't-know matcher is a line-for-line port of
// api/core/integrity_non_answer.py (also mirrored in
// mobile/src/utils/integrityMinimum.ts) — change all three together.

/** Plain floor on every typed reply — stops empty / "x" sends. */
export const MIN_MESSAGE_CHARS = 5;

const APOSTROPHES = /[‘’ʼ`´]/g;
const DASHES = /[‐-―−]/g;
const MATHY = /[0-9=+*/^<>%|\\√π∞≤≥≠×÷]/;
const NOT_WORDISH = /[^\p{L}\p{N}\s']/gu;

const FILLER = new Set([
  "lol", "lmao", "haha", "um", "umm", "uh", "uhh", "uhm", "hmm", "hm",
  "ugh", "really", "just", "honestly", "tbh", "sorry", "literally", "kinda",
]);

const PHRASES = [
  "i don't know", "i dont know", "i do not know", "don't know", "dont know",
  "idk", "i dunno", "dunno",
  "i have no idea", "i've no idea", "no idea",
  "i have no clue", "no clue",
  "i'm not sure", "im not sure", "i am not sure", "not sure",
  "i'm stuck", "im stuck", "i am stuck", "stuck",
  "i forgot", "i forget", "forgot",
  "i give up", "give up",
  "skip", "nothing",
];
const TAIL = "(?: how to (?:explain|do|solve|answer)(?: (?:this|it|that))?)?";
const ONE = `(?:${PHRASES.join("|")})${TAIL}`;
const ONLY_PHRASES = new RegExp(`^${ONE}(?: ${ONE})*$`);

function unify(text: string): string {
  return text.toLowerCase().replace(APOSTROPHES, "'").replace(DASHES, "-");
}

/** Lowercase, unify apostrophes/dashes, drop punctuation + emoji, collapse whitespace. */
export function normalizeReply(text: string): string {
  return unify(text)
    .replace(NOT_WORDISH, " ")
    .split(/\s+/)
    .map((tok) => tok.replace(/^'+|'+$/g, ""))
    .filter(Boolean)
    .join(" ");
}

/** True if the reply is essentially "I don't know" and nothing else. */
export function isNonAnswer(text: string): boolean {
  if (MATHY.test(unify(text))) return false;
  const words = normalizeReply(text)
    .split(" ")
    .filter((w) => w && !FILLER.has(w));
  // Only punctuation / emoji / filler ("???", "🤷", "lol").
  if (words.length === 0) return true;
  return ONLY_PHRASES.test(words.join(" "));
}

/** Whether a typed reply can be sent, given whether the stuck tap is used.
 *  Everyone gets the 5-char floor; once the tap is spent, a bare
 *  don't-know is turned back too. */
export function meetsTypedMinimum(message: string, stuckUsed: boolean): boolean {
  const text = message.trim();
  if (text.length < MIN_MESSAGE_CHARS) return false;
  return !(stuckUsed && isNonAnswer(text));
}
