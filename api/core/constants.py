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
# Image / file upload handling
# ---------------------------------------------------------------------------
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB after base64 decode
# PDFs are larger by nature (multi-page scans); 25 MB matches the
# teacher_documents.py upload cap and Anthropic's document-block limit.
MAX_PDF_BYTES = 25 * 1024 * 1024
# Whole-submission cap. With ≤10 files at up to 25 MB each the worst
# case is 250 MB, which we don't want hitting the row store. 50 MB is
# generous for real homework (a 10-photo phone submission tops out
# around 30 MB after client-side resize) and saves the DB from
# pathological payloads.
MAX_SUBMISSION_TOTAL_BYTES = 50 * 1024 * 1024
# Hard cap on number of files per submission. Mirrors the teacher
# upload cap. Real homework submissions are 1-3 pages; 10 leaves
# headroom for multi-page worksheets.
MAX_SUBMISSION_FILES = 10

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
