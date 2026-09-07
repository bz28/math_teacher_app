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
# Allowance for vision preprocessing GROWING an image on the way to the
# model. `extract_student_work` budgets the bytes it actually sends,
# which are measured AFTER `preprocess_image_for_vision`, so this has to
# be part of the derivation rather than an afterthought.
#
# An image carrying an EXIF rotation must be re-encoded, and rotating
# noisy scan content genuinely changes how well it compresses. Two
# mitigations in api/core/image_utils.py hold that down: images needing
# neither rotation nor downscaling are returned untouched (this removed
# a +37% case), and a re-encode that lands bigger than its source walks
# a quality ladder until it doesn't (this took a +35% low-quality-JPEG
# case down to +8.7%).
#
# The worst measured growth across hostile inputs — high sensor noise,
# source JPEGs down to quality 25 — is then 1.087. Budget 1.20 so the
# margin is set by measurement plus real headroom rather than by the
# worst case we happened to try. It costs ~2MB off a cap that no real
# submission approaches (the largest ever recorded in production is
# 6.1MB).
_VISION_REENCODE_GROWTH = 1.20
# Whole-submission cap, in DECODED bytes — the most raw file content a
# submission can carry and still be readable at the far end. Derived,
# because a submission's whole purpose is to reach Vision: files are
# stored base64 and forwarded base64, so decoded bytes re-inflate by 4/3
# on the way into the request budget above, and may grow again during
# preprocessing. A cap larger than this would accept homework that can
# never be read.
MAX_SUBMISSION_TOTAL_BYTES = (
    int(MAX_REQUEST_B64_BYTES / _VISION_REENCODE_GROWTH) * 3 // 4
)
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
