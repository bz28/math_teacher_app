"""Every action the backend logs has a frontend registry entry.

This is the drift that produced the bug. The dashboard's filter list and
its row-sentence switch were two independent hardcoded lists, so the
five `user.*` actions were filterable but rendered as an em-dash —
nobody noticed, because nothing connected the backend's vocabulary to
the frontend's. dashboard/src/lib/activityActions.ts is now the single
list; this test is the thing that keeps it honest when someone adds a
`record_activity` call and forgets it.

It reads source rather than importing, because the two sides are
different languages. A failure here is never subtle: it names the
action and the file to add it to.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_REGISTRY = _ROOT / "dashboard/src/lib/activityActions.ts"

# A dotted action name — "bank_item.workshop_accept". Deliberately wider
# than the names in use (digits and capitals allowed): a pattern that only
# matched today's spelling would make a new action with a digit in it
# invisible to BOTH sides of the comparison, and this test would pass
# while the row rendered from the raw-metadata fallback.
_ACTION_RE = r"[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*"
_ACTION = re.compile(f'"({_ACTION_RE})"')


def _backend_actions() -> set[str]:
    """Action literals passed to record_activity across api/.

    record_activity's signature puts `action` third, so the literal is
    always within a few lines of the call. Scanning that window rather
    than the whole file keeps unrelated dotted strings (module paths,
    content types) out of the result.
    """
    found: set[str] = set()
    for path in (_ROOT / "api").rglob("*.py"):
        lines = path.read_text().splitlines()
        for i, line in enumerate(lines):
            if "record_activity(" not in line:
                continue
            window = "\n".join(lines[i : i + 8])
            # Stop at the metadata dict — its keys and values are not
            # action names and could contain dotted strings. A consequence:
            # an action assembled as an f-string would be cut here and
            # missed. The reverse test below turns that into a failure
            # rather than a false pass, just with a confusing message.
            window = window.split("{")[0]
            found.update(_ACTION.findall(window))
    return found


def _registry_actions() -> set[str]:
    text = _REGISTRY.read_text()
    return set(re.findall(rf'action:\s*"({_ACTION_RE})"', text))


def test_every_logged_action_is_in_the_frontend_registry() -> None:
    backend = _backend_actions()
    # Guard the guard: if the scan silently stops finding anything, the
    # comparison below passes vacuously and this test protects nothing.
    assert len(backend) >= 16, f"action scan found only {backend} — regex broke?"

    missing = backend - _registry_actions()
    assert not missing, (
        f"These actions are logged by the backend but have no entry in "
        f"{_REGISTRY.relative_to(_ROOT)}, so they render as an em-dash and "
        f"can't be filtered: {sorted(missing)}"
    )


def test_registry_has_no_actions_the_backend_never_writes() -> None:
    """The other direction: a dropdown option that can only ever return
    zero rows is worse than no option — it reads as a broken filter,
    which is the exact complaint this work started from."""
    stale = _registry_actions() - _backend_actions()
    assert not stale, (
        f"These actions are offered by the frontend registry but nothing "
        f"in api/ logs them: {sorted(stale)}"
    )
