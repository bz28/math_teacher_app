"""Deterministic "don't know" detection for the understanding-check chat.

Once a student has spent their one "I'm stuck" tap on a problem, a typed
reply that is *only* a don't-know non-answer ("idk", "I have no idea",
"not sure lol") is turned back with a nudge to try in their own words.
Anything else — and in particular every compact math answer ("y=2x+3",
"(3, 4)", "12.5 cm") — goes through.

Mirrored exactly by web/src/components/school/student/integrity-message-rules.ts
and mobile/src/utils/integrityMinimum.ts; the three table-driven test files
share the same cases. Keep the lists tight: a false positive blocks an
honest student, a false negative only lets one more "idk" through.
"""

from __future__ import annotations

import re

# Curly / modifier apostrophes and backticks → '
_APOSTROPHES = re.compile(r"[‘’ʼ`´]")
# Hyphen / dash variants (incl. iOS smart-punctuation em dash, minus) → -
_DASHES = re.compile(r"[‐-―−]")
# Any digit or math symbol means the reply is attempting math → an answer.
_MATHY = re.compile(r"[0-9=+*/^<>%|\\√π∞≤≥≠×÷]")
# Everything that isn't a letter, digit, whitespace or apostrophe
# (punctuation, emoji, dashes) is dropped before phrase matching.
_NOT_WORDISH = re.compile(r"[^\w\s']|_")

# Words that carry no answer on their own; removed before matching.
_FILLER = frozenset({
    "lol", "lmao", "haha", "um", "umm", "uh", "uhh", "uhm", "hmm", "hm",
    "ugh", "really", "just", "honestly", "tbh", "sorry", "literally", "kinda",
})

# Don't-know phrasings. A reply is a non-answer only if it's made of
# nothing but these (repeats allowed: "idk idk idk").
_PHRASES = (
    "i don't know", "i dont know", "i do not know", "don't know", "dont know",
    "idk", "i dunno", "dunno",
    "i have no idea", "i've no idea", "no idea",
    "i have no clue", "no clue",
    "i'm not sure", "im not sure", "i am not sure", "not sure",
    "i'm stuck", "im stuck", "i am stuck", "stuck",
    "i forgot", "i forget", "forgot",
    "i give up", "give up",
    "skip", "nothing",
)
# "...how to explain this" / "...how to do it" tails on a don't-know.
_TAIL = r"(?: how to (?:explain|do|solve|answer)(?: (?:this|it|that))?)?"
_ONE = "(?:" + "|".join(re.escape(p) for p in _PHRASES) + ")" + _TAIL
_ONLY_PHRASES = re.compile(rf"{_ONE}(?: {_ONE})*")


def normalize_reply(text: str) -> str:
    """Lowercase, unify apostrophes and dashes, drop punctuation/emoji,
    collapse whitespace. Also used to match the stuck text, so smart
    punctuation and case variants still count as the tap."""
    t = _DASHES.sub("-", _APOSTROPHES.sub("'", text.lower()))
    t = _NOT_WORDISH.sub(" ", t)
    return " ".join(tok.strip("'") for tok in t.split() if tok.strip("'"))


def is_non_answer(text: str) -> bool:
    """True if the reply is essentially "I don't know" and nothing else."""
    lowered = _DASHES.sub("-", _APOSTROPHES.sub("'", text.lower()))
    if _MATHY.search(lowered):
        return False
    words = [w for w in normalize_reply(text).split() if w not in _FILLER]
    if not words:
        # Only punctuation / emoji / filler ("???", "🤷", "lol").
        return True
    return _ONLY_PHRASES.fullmatch(" ".join(words)) is not None
