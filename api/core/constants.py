"""Centralized operational constants for the API.

Collect all tunable limits, caps, and thresholds here so they can be
reviewed and adjusted in one place.
"""

# ---------------------------------------------------------------------------
# Session limits
# ---------------------------------------------------------------------------
MAX_PROBLEM_LENGTH = 10_000
RECENT_EXCHANGES_LIMIT = 10
MAX_STUDENT_MESSAGES = 10

# ---------------------------------------------------------------------------
# LLM / tutor
# ---------------------------------------------------------------------------
LLM_HISTORY_LIMIT = 6  # max recent exchanges sent to chat functions

# ---------------------------------------------------------------------------
# Decomposition cache
# ---------------------------------------------------------------------------
DECOMPOSITION_CACHE_TTL_SECONDS = 30 * 60  # 30 minutes
DECOMPOSITION_CACHE_MAX_SIZE = 200

# ---------------------------------------------------------------------------
# Work submission personalization
# ---------------------------------------------------------------------------
WORK_SUBMISSION_TTL_MINUTES = 30  # Discard work diagnosis after this window

# ---------------------------------------------------------------------------
# Anthropic request budget
# ---------------------------------------------------------------------------
# Anthropic caps a single request at 32MB. That is the one physical
# constraint on how much homework can move through this system, so the
# upload caps below are DERIVED from it rather than picked separately.
#
# They used to be picked separately, and it cost us: a 10MB transport
# cap written with the original scaffold and a 50MB submission cap added
# eight weeks later never had any relationship to each other. The
# transport cap silently rejected submissions the endpoint would have
# happily accepted, surfacing as an opaque 413 on a student's phone, and
# it made the endpoint's own 50MB check unreachable dead code. Deriving
# both from this number is what makes that class of bug impossible
# rather than merely fixed — so add new caps by deriving them here, not
# by writing another literal somewhere else.
ANTHROPIC_MAX_REQUEST_BYTES = 32 * 1024 * 1024
# Headroom for the prompt, tool schema and JSON envelope that ride along
# with the payload. These are kilobytes in practice and base64 needs no
# JSON escaping, so a megabyte is generous. Over-reserving is not
# "safe": it drops payloads the API would have accepted.
_REQUEST_HEADROOM_BYTES = 1024 * 1024
# The largest base64 payload we will put in a single Claude request.
MAX_REQUEST_B64_BYTES = ANTHROPIC_MAX_REQUEST_BYTES - _REQUEST_HEADROOM_BYTES

# ---------------------------------------------------------------------------
# Image / file upload handling
# ---------------------------------------------------------------------------
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB after base64 decode
# PDFs are larger by nature (multi-page scans); 25 MB matches the
# teacher_documents.py upload cap and Anthropic's document-block limit.
MAX_PDF_BYTES = 25 * 1024 * 1024
# Slack so a MAXIMAL submission lands strictly UNDER the request budget
# rather than exactly on it. base64 pads each file up to 4 bytes, and
# vision preprocessing re-encodes images (which can nudge a small one
# either way). Without this the largest legal submission sits exactly at
# the budget, and a few bytes of padding would trip the extraction guard
# on work the API would have accepted — rejecting a student's homework
# over rounding.
_SUBMISSION_SLACK_BYTES = 64 * 1024
# Whole-submission cap, in DECODED bytes — the most raw file content a
# submission can carry and still be readable at the far end. Derived,
# because a submission's whole purpose is to reach Vision: files are
# stored base64 and forwarded base64, so decoded bytes re-inflate by 4/3
# on the way into the request budget above. A cap larger than this would
# accept homework that can never be read.
MAX_SUBMISSION_TOTAL_BYTES = (MAX_REQUEST_B64_BYTES - _SUBMISSION_SLACK_BYTES) * 3 // 4
# Transport cap floor: the smallest HTTP body limit that can still carry
# a maximal legal submission. Files arrive base64 inside JSON, so the
# body runs ~4/3 the decoded size, plus the JSON envelope (keys, quotes,
# commas, data: prefixes). `Settings.max_request_size` is floored at
# this — see api/config.py for why it may be raised but never lowered.
MIN_REQUEST_SIZE_BYTES = MAX_SUBMISSION_TOTAL_BYTES * 4 // 3 + 1024 * 1024
# Hard cap on number of files per submission. Mirrors the teacher
# upload cap. Real homework submissions are 1-3 pages; 10 leaves
# headroom for multi-page worksheets.
MAX_SUBMISSION_FILES = 10

# Per-field cap on the teacher's grading rubric. These four free-text
# fields are rendered verbatim into the grading prompt
# (`grading_ai._build_rubric_block`), so an unbounded field is an
# unbounded prompt. Matches the 2000-char cap the per-problem feedback
# textarea already uses.
MAX_RUBRIC_FIELD_CHARS = 2000

# ---------------------------------------------------------------------------
# Logging / storage
# ---------------------------------------------------------------------------
MAX_STORED_TEXT_LENGTH = 10 * 1024  # truncate LLM call logs beyond this

# ---------------------------------------------------------------------------
# Question-bank solution generation
# ---------------------------------------------------------------------------
# Stored as a bank item's `final_answer` when automatic step decomposition
# throws while solving a generated question. It is a placeholder, NOT a real
# answer key — the approve gate rejects it so it can never be attached to a
# homework as a graded answer. Match by the SENTINEL_PREFIX (em-dash / copy
# may drift) rather than the exact string when gating.
SOLUTION_FAILED_SENTINEL = "(solution failed — please solve manually)"
SOLUTION_FAILED_SENTINEL_PREFIX = "(solution failed"


# Seeded into a new homework's student-visible instructions so the
# expectation is on the page before the student starts working.
#
# It lives in the teacher's own Instructions block rather than as a
# separate platform line, because that block already renders at the top
# of the student's homework page and a second instruction beside it read
# as a near-duplicate. A default she can edit or delete keeps one voice
# on the page and leaves her in control of what her students are told.
#
# Homework only — practice has no student-visible instructions surface.
DEFAULT_HOMEWORK_INSTRUCTIONS = "Write neatly and show your work."
