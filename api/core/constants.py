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

# ---------------------------------------------------------------------------
# Logging / storage
# ---------------------------------------------------------------------------
MAX_STORED_TEXT_LENGTH = 10 * 1024  # truncate LLM call logs beyond this
