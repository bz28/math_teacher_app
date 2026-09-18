"""Describing a failure without quoting the student.

Two functions, one rule: an exception that touched a row containing
student work must not be formatted or traced verbatim.

## Why this is its own module

The rule is not specific to one queue. Anywhere we write student-derived
text to Postgres — `submissions.extraction`, `llm_calls.input_text` and
`output_text` — a failure on that write raises a SQLAlchemy
``StatementError``, and its ``__str__`` appends the statement AND its
bound parameters::

    StatementError: canceling statement due to statement timeout
    [SQL: UPDATE submissions SET extraction=%(extraction)s WHERE id=...]
    [parameters: {'extraction': {'steps': [{'latex': "the student's
     handwriting, transcribed"}]}}]

Formatting that into a log line, or persisting it to an error column,
publishes a child's schoolwork. We sell to districts, and the rule
written on ``activity_log`` is ids, counts and codes — never content.

Each place that learned this lesson separately got it slightly wrong, so
it lives here once instead.

## The two traps, both of which have bitten

**The message.** ``f"{exc}"`` on a ``StatementError`` includes the
parameters. `safe_error` keeps the wrapper's class name and the
DRIVER's message (``.orig``) — the server's own "canceling statement due
to statement timeout", "deadlock detected" — which is what anyone
actually acts on, and never the statement or its values.

**The chain.** A traceback prints every linked exception — "During
handling of the above exception, another exception occurred" — so an
exception that is itself harmless still leaks when a ``StatementError``
is sitting in its ``__context__``. That is the likely shape rather than
a corner case: the write and the bookkeeping that follows it are lines
apart, so whatever kills one tends to kill the other, and it is the
second that reaches the logger. `traceback_is_safe` walks the whole
chain, which the first version of this guard did not.

Sentry matters here too: with the logging integration enabled, an ERROR
event goes to a third-party processor. `api/main.py` turns off both
frame locals and request-body capture for the same reason.
"""

from sqlalchemy.exc import SQLAlchemyError

MAX_ERROR_CHARS = 2000


def safe_error(exc: BaseException) -> str:
    """Format an exception for a log line or a durable error column.

    SQLAlchemy errors are reduced to their class name plus the driver's
    own message. Everything else is formatted in full — those are our
    raises and the SDKs', and none carry student work: the Vision parse
    errors report a position or a ``stop_reason``, not content.
    """
    if isinstance(exc, SQLAlchemyError):
        orig = getattr(exc, "orig", None)
        detail = str(orig) if orig is not None else "no driver detail"
        return f"{type(exc).__name__}: {detail}"[:MAX_ERROR_CHARS]
    return f"{type(exc).__name__}: {exc}"[:MAX_ERROR_CHARS]


def traceback_is_safe(exc: BaseException) -> bool:
    """May this exception be logged WITH its traceback (``exc_info``)?

    Only when no SQLAlchemy error appears anywhere in its cause/context
    chain. Guards against a cycle, which ``raise ... from`` can build.
    """
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        if isinstance(cur, SQLAlchemyError):
            return False
        seen.add(id(cur))
        cur = cur.__cause__ or cur.__context__
    return True
