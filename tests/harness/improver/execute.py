"""Approval → execution bridge.

The coding itself (/plan, /autopilot, /review, open PR) is done by a Claude
SUBAGENT, not Python — so this module's job is to assemble the precise
execution BRIEF for one approved proposal: what to change, where to look, the
guardrails (size cap, forbidden surfaces, stop at PR-open), and how to verify
(harness for-diff + a cold review). The orchestrating agent spawns one
worktree-isolated subagent per approved proposal with this brief as its prompt.

Keeping the brief here (not buried in a doc) means it's versioned, reviewable,
and testable like everything else.
"""

from __future__ import annotations


def where_to_look(surface_key: str) -> list[str]:
    """Best-effort pointer to the code a proposal likely touches, from its
    surface key. Generation proposals map to the probe's own relevant_paths;
    web/admin/mobile surfaces map to their app root."""
    if surface_key.startswith("generation:"):
        probe = surface_key.split(":", 1)[1].split("+")[0].strip()
        try:
            from tests.harness.probes import PROBES
            if probe in PROBES:
                return PROBES[probe](1).relevant_paths()
        except Exception:  # noqa: BLE001 — hint only, never fatal
            return []
    roots = {"web": "web/src/", "admin": "dashboard/src/", "mobile": "mobile/src/"}
    hits = [root for prefix, root in roots.items() if surface_key.startswith(prefix)]
    return hits or ["(search the repo for the surface above)"]


def build_brief(proposal: dict[str, object], *, branch: str, base: str = "main") -> str:
    """The full subagent prompt to implement one approved proposal end-to-end,
    stopping at PR-open. `base` is the *preferred* base branch, but the agent is
    told to verify the target code actually lives there and fall back to the
    branch that has it (this repo stacks unmerged features)."""
    surface = str(proposal.get("surface_key", ""))
    paths = where_to_look(surface)
    where = "\n".join(f"  - {p}" for p in paths)
    return f"""You are implementing ONE approved improvement in the math_teacher_app repo.
Follow the repo's CLAUDE.md workflow exactly. Work autonomously through to an
open PR, then STOP — do not merge.

## Proposal
- id: {proposal.get('id')}
- title: {proposal.get('title')}
- category: {proposal.get('category')} · severity: {proposal.get('severity')} · est size: {proposal.get('est_size')}
- surface: {surface}
- rationale: {proposal.get('rationale')}
- change to make: {proposal.get('change')}

## Where to look
{where}

## Guardrails (hard)
- Keep the diff SMALL and single-purpose (≈<150 lines). If it can't be done
  small, stop and report back instead of opening a PR.
- Do NOT touch database schema, auth, or billing. If the change drifts into
  those, stop and report back.
- Branch: {branch}. Conventional-commit messages. Do NOT push to main.

## Steps
0. Pick the right base. Preferred base is `{base}`, BUT this repo stacks
   unmerged feature work — so first verify the files under "Where to look" exist
   on it (`git cat-file -e {base}:<path>`). If they DON'T, find the branch that
   does (`git branch -a --contains` / search) and branch off that instead. Don't
   open a PR against a base that lacks the code.
1. Create `{branch}` off the chosen base, `/plan` the change briefly, implement.
2. If a harness probe covers the touched files, run
   `python -m tests.harness for-diff --base main --mode replay` and fold in the result.
3. Run a fresh, cold-context `/review` (or the code-review skill) and address
   confirmed findings.
4. Push the branch and open a PR whose body links proposal id {proposal.get('id')}
   and summarizes what/why/how-tested. Then STOP and report the PR URL.
"""
