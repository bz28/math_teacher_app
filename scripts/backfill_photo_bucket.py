"""Move students' homework photos out of Postgres into the photo bucket.

Rows written before api/core/photo_store.py carry each page inline in
`submissions.files` / `submission_attempts.files` as base64
(`{"data": ..., "media_type": ...}`). This uploads each such page to the
bucket and rewrites the row's entry to the key form the app writes now
(`{"key": ..., "media_type": ...}`, every other field kept).

SAFETY — these are real students' homework
  * Dry run by default: reads and reports, uploads and writes nothing.
    Pass --go to move photos.
  * A row's inline data is dropped only after EVERY one of its pages is
    uploaded and verified: the stored object's size matches, and it is
    downloaded again and its sha256 matches the decoded bytes. Any failure
    leaves the row exactly as it was, and the run carries on.
  * One row per transaction, and the rewrite is conditional on the row
    being unchanged since it was read (md5 of its files) — a retake or
    reopen that lands mid-run is never overwritten; that row is skipped
    and picked up by the next run.
  * Idempotent and resumable: only rows still holding inline data are
    selected, and an object's key is derived from its bytes
    (`submissions/<submission id>/<sha256 prefix>.<ext>`), so a run that
    stopped between upload and rewrite re-uploads to the same key.
  * Refuses to run unless the store is the S3 bucket (PHOTO_BUCKET set), so
    photos can't be "moved" onto the local disk of whoever runs it.
  * Never prints credentials, presigned URLs or photo bytes.

Disk space in Postgres is reclaimed only by a later VACUUM (FULL) of the two
tables; this script doesn't run one.

USAGE (take a Railway Postgres backup first)
  export DATABASE_URL=<prod url, postgresql+asyncpg://...>
  export PHOTO_BUCKET=... PHOTO_BUCKET_ENDPOINT=... PHOTO_BUCKET_REGION=auto \\
         PHOTO_BUCKET_ACCESS_KEY_ID=... PHOTO_BUCKET_SECRET_ACCESS_KEY=...
  python -m scripts.backfill_photo_bucket                 # dry run
  python -m scripts.backfill_photo_bucket --go --limit 3  # move a few, check them
  python -m scripts.backfill_photo_bucket --go            # move the rest
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text

TABLES = ("submissions", "submission_attempts")


@dataclass
class Tally:
    rows: int = 0
    pages: int = 0
    bytes: int = 0
    moved: int = 0
    failed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _decode(entry: dict[str, Any]) -> tuple[bytes, str]:
    """An inline entry's bytes and media type. Raises ValueError on
    anything that doesn't decode to bytes."""
    data = entry.get("data")
    if not isinstance(data, str) or not data:
        raise ValueError("empty or non-string data")
    media_type = entry.get("media_type")
    if data.startswith("data:"):
        header, _, data = data.partition(",")
        media_type = media_type or header[5:].split(";", 1)[0]
    try:
        # Decoded exactly as the app decoded it at submit and for the
        # reader (`validate_and_decode_upload`: non-strict), so the object
        # is the very bytes every grade so far was made from.
        raw = base64.b64decode(data)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"invalid base64 ({e})") from e
    if not raw:
        raise ValueError("decodes to nothing")
    return raw, str(media_type or "image/jpeg")


def _key(submission_id: str, raw: bytes, media_type: str) -> str:
    from api.core.photo_store import EXTENSIONS, KEY_PREFIX

    return f"{KEY_PREFIX}{submission_id}/{hashlib.sha256(raw).hexdigest()[:32]}.{EXTENSIONS.get(media_type, 'bin')}"


async def _move_page(store: Any, key: str, raw: bytes, media_type: str) -> None:
    """Upload one page and prove it landed intact. Raises on any doubt."""
    await asyncio.to_thread(store.put, key, raw, media_type)
    size = await asyncio.to_thread(store.size, key)
    if size != len(raw):
        raise ValueError(f"stored size {size} != {len(raw)}")
    back = await asyncio.to_thread(store.get, key)
    if hashlib.sha256(back).digest() != hashlib.sha256(raw).digest():
        raise ValueError("sha256 of the stored object doesn't match")


async def _backfill_row(db_factory: Any, store: Any, table: str, row_id: str, go: bool, tally: Tally) -> str:
    """Move one row's inline pages. Returns a one-line outcome."""
    sid_col = "id" if table == "submissions" else "submission_id"
    async with db_factory() as db:
        row = (await db.execute(
            text(
                f"SELECT {sid_col} AS sid, files::text AS files, md5(files::text) AS digest "
                f"FROM {table} WHERE id = :id"
            ),
            {"id": row_id},
        )).one_or_none()
    if row is None:
        tally.skipped.append(f"{table} {row_id}")
        return "gone"
    files = json.loads(row.files)
    if not isinstance(files, list):
        tally.skipped.append(f"{table} {row_id}")
        return "files isn't a list — left alone"
    new_files: list[Any] = []
    work: list[tuple[str, bytes, str]] = []
    for i, entry in enumerate(files, start=1):
        if not isinstance(entry, dict) or "data" not in entry:
            new_files.append(entry)
            continue
        try:
            raw, media_type = _decode(entry)
        except ValueError as e:
            tally.failed.append(f"{table} {row_id}")
            return f"FAILED page {i}: {e} — row left as it was"
        key = _key(str(row.sid), raw, media_type)
        work.append((key, raw, media_type))
        new_files.append({**{k: v for k, v in entry.items() if k != "data"}, "media_type": media_type, "key": key})
    tally.rows += 1
    tally.pages += len(work)
    tally.bytes += sum(len(w[1]) for w in work)
    size = f"{len(work)} page(s), {sum(len(w[1]) for w in work) / 1e6:.1f} MB"
    if not go:
        return f"would move {size}"
    try:
        await asyncio.gather(*(_move_page(store, k, raw, mt) for k, raw, mt in work))
    except Exception as e:  # noqa: BLE001 — any doubt leaves the row as it was
        tally.failed.append(f"{table} {row_id}")
        return f"FAILED upload/verify ({type(e).__name__}: {e}) — row left as it was"
    async with db_factory() as db:
        result = await db.execute(
            text(f"UPDATE {table} SET files = CAST(:files AS json) WHERE id = :id AND md5(files::text) = :digest"),
            {"files": json.dumps(new_files), "id": row_id, "digest": row.digest},
        )
        if result.rowcount != 1:
            await db.rollback()
            tally.skipped.append(f"{table} {row_id}")
            return "changed while moving (a retake or reopen?) — left for the next run"
        await db.commit()
    tally.moved += 1
    return f"moved {size} (verified)"


async def backfill(db_factory: Any, store: Any, *, go: bool, limit: int | None = None) -> Tally:
    from api.core.photo_store import S3Backend

    if not isinstance(store, S3Backend):
        raise SystemExit("REFUSING: PHOTO_BUCKET is unset — the store isn't the bucket.")
    tally = Tally()
    todo: list[tuple[str, str]] = []
    async with db_factory() as db:
        for table in TABLES:
            ids = (await db.execute(text(
                f"SELECT id::text FROM {table} WHERE files IS NOT NULL AND json_typeof(files) = 'array' "
                "AND jsonb_path_exists(files::jsonb, '$[*].data') ORDER BY id"
            ))).scalars().all()
            todo += [(table, i) for i in ids]
    if limit is not None:
        todo = todo[:limit]
    print(f"{len(todo)} row(s) hold inline photos{' (limited)' if limit is not None else ''}.")
    for n, (table, row_id) in enumerate(todo, start=1):
        outcome = await _backfill_row(db_factory, store, table, row_id, go, tally)
        print(f"  [{n}/{len(todo)}] {table} {row_id}: {outcome}", flush=True)
    verb = "Moved" if go else "Would move"
    print(
        f"{verb} {tally.pages} page(s), {tally.bytes / 1e6:.1f} MB, from {tally.rows} row(s). "
        f"Rows rewritten: {tally.moved}. Failed: {len(tally.failed)}. Skipped: {len(tally.skipped)}."
    )
    if tally.failed:
        print("Failed rows (inline data kept):", *tally.failed, sep="\n  ")
    if not go:
        print("Dry run: nothing uploaded or written. Pass --go to move them.")
    return tally


async def main(go: bool, limit: int | None) -> int:
    from api.config import settings
    from api.core import photo_store
    from api.database import get_session_factory

    print(f"Bucket: {settings.photo_bucket or '(unset)'} at {settings.photo_bucket_endpoint or '(default endpoint)'}")
    tally = await backfill(get_session_factory(), photo_store.backend(), go=go, limit=limit)
    return 1 if tally.failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--go", action="store_true", help="upload and rewrite rows (default: dry run)")
    parser.add_argument("--limit", type=int, default=None, help="process at most this many rows")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.go, args.limit)))
