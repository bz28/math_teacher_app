"""Durable proposal queue + decline memory.

The scan produces proposals; this persists them so (a) the same idea isn't
re-surfaced on every run (dedupe against everything ever seen — proposed,
rejected, or shipped), and (b) an approval/rejection survives between the scan
run that proposed it and the later execution run that acts on it. State is
plain JSON under IMPROVER_STATE_DIR; in the cloud loop that directory is
committed to the `improver/state` branch, because cloud runs clone the repo
fresh and on-disk state would otherwise vanish between runs.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from tests.harness.improver.budget import _atomic_write, state_dir
from tests.harness.improver.proposals import Proposal, to_dict

# proposed → (approved → done) | rejected
STATUSES = ("proposed", "approved", "rejected", "done")


@dataclass
class QueuedProposal:
    proposal: dict[str, object]  # to_dict(Proposal); carries id + score
    status: str = "proposed"
    created: str = ""
    updated: str = ""

    @property
    def id(self) -> str:
        return str(self.proposal.get("id", ""))


@dataclass
class Queue:
    path: Path
    items: list[QueuedProposal] = field(default_factory=list)

    @classmethod
    def load(cls, directory: Path | None = None) -> Queue:
        path = (directory or state_dir()) / "proposals.json"
        items: list[QueuedProposal] = []
        if path.exists():
            try:
                raw = json.loads(path.read_text())
            except json.JSONDecodeError:
                raw = []
            for it in raw:  # skip only corrupt rows, never drop the whole queue
                try:
                    items.append(QueuedProposal(**it))
                except TypeError:
                    continue
        return cls(path=path, items=items)

    def save(self) -> None:
        _atomic_write(self.path, json.dumps([asdict(it) for it in self.items], indent=2))

    def seen_ids(self) -> set[str]:
        """Every id we've ever recorded — used to never re-propose a known idea."""
        return {it.id for it in self.items}

    def add(self, proposals: list[Proposal], *, now: datetime | None = None) -> list[Proposal]:
        """Append proposals not already in the queue as `proposed`; return the
        newly-added ones."""
        ts = (now or datetime.now(UTC)).isoformat()
        seen = self.seen_ids()
        added: list[Proposal] = []
        for p in proposals:
            if p.id in seen:
                continue
            seen.add(p.id)
            self.items.append(QueuedProposal(
                proposal=to_dict(p), status="proposed", created=ts, updated=ts,
            ))
            added.append(p)
        if added:
            self.save()
        return added

    def get(self, proposal_id: str) -> QueuedProposal | None:
        return next((it for it in self.items if it.id == proposal_id), None)

    def set_status(self, proposal_id: str, status: str, *, now: datetime | None = None) -> bool:
        if status not in STATUSES:
            raise ValueError(f"unknown status {status!r}")
        it = self.get(proposal_id)
        if it is None:
            return False
        it.status = status
        it.updated = (now or datetime.now(UTC)).isoformat()
        self.save()
        return True

    def by_status(self, *statuses: str) -> list[QueuedProposal]:
        want = set(statuses)
        return [it for it in self.items if it.status in want]
