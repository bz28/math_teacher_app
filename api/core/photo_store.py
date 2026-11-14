"""Students' homework photos, kept in object storage instead of Postgres.

A turn-in's pages live in `submissions.files` (and, for the turn-ins a
retake or reopen replaced, `submission_attempts.files`): a list with one
entry per uploaded file. The page itself is an object in the photo bucket,
and its entry names it:

    {"key": "submissions/<submission id>/<random hex>.jpg", "media_type": "image/jpeg"}

Rows written before the move carry the page inline instead —
`{"data": <base64>, "media_type": ...}` (~7 MB a submission; 2.1 GB of a
2.2 GB database in Nov 2026) — until `scripts/backfill_photo_bucket.py`
moves them. Every reader goes through this module and accepts both; the
inline branches (marked INLINE) are removed in a follow-up once the
backfill has run.

Three operations, one per kind of caller:

- `store_pages`  — the write path (submit, retake, reopen resubmit): uploads
  every page in parallel and returns the entries to save. Raises
  `PhotoStoreError` if any upload fails, so the request fails instead of
  saving a turn-in with no photos.
- `load_pages`   — the AI/processing path (the reader, the drawing check's
  zoomed crops, PDF rendering): the entries with each page's bytes as
  base64 under `data`, fetched concurrently, at full resolution.
- `pages_out`    — the serving path (teacher detail, originals, student
  submission, admin drill-in): a short-lived presigned GET URL per page
  instead of the bytes.

And one for deleting: a row's pages don't go with the row (a cascade from
a user, course, section or assignment drops the rows, never the objects),
so every path that deletes submissions collects their pages FIRST with
`pages_of_submissions` / `pages_of_user`, commits, and only then calls
`delete_pages` — a delete that rolls back keeps its photos. A student's
deletion request has to remove their photos, not just their rows.

## Why presigned URLs, and why an hour

The bucket is private (Railway offers no public buckets) and the photos
are children's homework, so a page is only ever reachable through a
signed URL: a bearer link that works for anyone holding it until it
expires. So the links are short-lived, the keys are unguessable (a random
128-bit name under the submission), and a URL is never logged. An hour
covers a teacher's grading sitting — the web client keeps the first URL
it got for a page until it's near expiry, so reopening a student reuses
it and the browser's cache serves the photo again instead of
re-downloading it (each response signs a fresh URL, and the browser
caches by URL) — while bounding how long a link copied out of a session
keeps working.

## Environments

Production uses the bucket (PHOTO_BUCKET + endpoint, region and keys in
api/config.py). Development and test without a bucket store pages on local
disk and serve them through a signed dev route (`api/routes/dev_photos.py`),
so the app, the test suite and the harness run with no credentials.
Production without a bucket refuses uploads (503) rather than storing
photos anywhere else.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import ColumnElement, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings

logger = logging.getLogger(__name__)

# How long a presigned page URL works. See the module docstring.
PRESIGN_SECONDS = 3600

# The objects never change (a new upload is a new key), so a browser may
# keep one as long as it holds the URL. `private`: never a shared cache.
_CACHE_CONTROL = "private, max-age=86400, immutable"

EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}

KEY_PREFIX = "submissions/"


class PhotoStoreError(RuntimeError):
    """The photo store couldn't save, read or find a page."""


class Backend(Protocol):
    def put(self, key: str, body: bytes, media_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def size(self, key: str) -> int | None: ...
    def delete(self, key: str) -> None: ...
    def url(self, key: str, expires_in: int) -> str: ...


class S3Backend:
    """An S3-compatible bucket (Railway: Tigris at t3.storageapi.dev,
    region "auto", virtual-host addressing). boto3 is blocking; callers
    in this module run it in a thread. The client is thread-safe."""

    def __init__(
        self, *, bucket: str, endpoint: str, region: str, access_key_id: str, secret_access_key: str,
    ) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            region_name=region or "auto",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "virtual"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=60,
                # A 10-page turn-in uploads its pages at once, and several
                # students may be turning in together.
                max_pool_connections=32,
            ),
        )

    def put(self, key: str, body: bytes, media_type: str) -> None:
        # Content-MD5 makes the store refuse a body that arrived corrupted
        # (BadDigest) instead of keeping it.
        self._client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=media_type,
            ContentMD5=base64.b64encode(hashlib.md5(body).digest()).decode("ascii"),
            CacheControl=_CACHE_CONTROL,
        )

    def get(self, key: str) -> bytes:
        body: bytes = self._client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        return body

    def size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            head = self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return int(head["ContentLength"])

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=key)

    def url(self, key: str, expires_in: int) -> str:
        url: str = self._client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires_in,
        )
        return url


class LocalBackend:
    """Pages on local disk, for development and tests without a bucket.
    URLs point at the dev route (`api/routes/dev_photos.py`) and are
    signed and expiring like presigned ones, so the client code path is
    the same."""

    def __init__(self, *, root: Path, base_url: str, secret: str) -> None:
        self.root = root
        self.base_url = base_url.rstrip("/")
        self._secret = secret.encode()

    def path(self, key: str) -> Path:
        if not key.startswith(KEY_PREFIX) or ".." in key.split("/"):
            raise PhotoStoreError("Not a photo key")
        return self.root / key

    def put(self, key: str, body: bytes, media_type: str) -> None:
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)

    def get(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def size(self, key: str) -> int | None:
        path = self.path(key)
        return path.stat().st_size if path.exists() else None

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def signature(self, key: str, expires: int) -> str:
        return hmac.new(self._secret, f"{key}:{expires}".encode(), hashlib.sha256).hexdigest()

    def url(self, key: str, expires_in: int) -> str:
        expires = int(time.time()) + expires_in
        return f"{self.base_url}/v1/dev/photos/{key}?expires={expires}&sig={self.signature(key, expires)}"

    def verify(self, key: str, expires: int, sig: str) -> bool:
        return expires >= time.time() and hmac.compare_digest(sig, self.signature(key, expires))


_backend: Backend | None = None


def configured() -> bool:
    """Whether uploads have somewhere to go in this environment."""
    return bool(settings.photo_bucket) or settings.app_env in ("development", "test")


def backend() -> Backend:
    """The store for this environment, built on first use."""
    global _backend
    if _backend is None:
        if settings.photo_bucket:
            _backend = S3Backend(
                bucket=settings.photo_bucket,
                endpoint=settings.photo_bucket_endpoint,
                region=settings.photo_bucket_region,
                access_key_id=settings.photo_bucket_access_key_id,
                secret_access_key=settings.photo_bucket_secret_access_key,
            )
        elif configured():
            root = Path(settings.photo_local_dir or Path(tempfile.gettempdir()) / "veradic-photos")
            _backend = LocalBackend(root=root, base_url=settings.photo_local_base_url, secret=settings.jwt_secret)
        else:
            raise PhotoStoreError("Photo storage isn't configured (PHOTO_BUCKET is unset)")
    return _backend


def set_backend(b: Backend | None) -> None:
    """Swap the store (tests). None rebuilds it from settings on next use."""
    global _backend
    _backend = b


def new_key(submission_id: uuid.UUID | str, media_type: str) -> str:
    """An unguessable object name scoped to its submission."""
    return f"{KEY_PREFIX}{submission_id}/{uuid.uuid4().hex}.{EXTENSIONS.get(media_type, 'bin')}"


def _inline_base64(entry: dict[str, Any]) -> str:
    """INLINE: a pre-backfill entry's base64, without any `data:` prefix."""
    data = str(entry.get("data") or "")
    return data.split(",", 1)[1] if data.startswith("data:") else data


async def store_pages(submission_id: uuid.UUID, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Upload a turn-in's pages (entries with base64 `data`) in parallel.

    Returns the entries to save: each page's other fields, with `key` in
    place of `data`. If any upload fails, the ones that landed are deleted
    and `PhotoStoreError` is raised — the caller fails the request rather
    than save a turn-in whose photos aren't there."""
    store = backend()
    out = [
        {**{k: v for k, v in p.items() if k != "data"}, "key": new_key(submission_id, p["media_type"])}
        for p in pages
    ]

    def put(entry: dict[str, Any], page: dict[str, Any]) -> None:
        store.put(entry["key"], base64.b64decode(_inline_base64(page)), entry["media_type"])

    results = await asyncio.gather(
        *(asyncio.to_thread(put, e, p) for e, p in zip(out, pages, strict=True)),
        return_exceptions=True,
    )
    failures = [r for r in results if isinstance(r, BaseException)]
    if failures:
        landed = [e for e, r in zip(out, results, strict=True) if not isinstance(r, BaseException)]
        await delete_pages(landed)
        logger.error(
            "photo upload failed for submission %s (%d of %d pages): %s",
            submission_id, len(failures), len(pages), type(failures[0]).__name__,
        )
        raise PhotoStoreError("Couldn't save the photos") from failures[0]
    return out


async def load_pages(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """The pages with their bytes, for the reader and the drawing check:
    each entry with `data` set to the page's base64 (no prefix), fetched
    from the store concurrently, at the resolution it was uploaded at."""

    def fetch(entry: dict[str, Any]) -> dict[str, Any]:
        if "key" in entry:
            return {**entry, "data": base64.b64encode(backend().get(entry["key"])).decode("ascii")}
        # INLINE: a row the backfill hasn't moved yet — passed on exactly
        # as stored (a `data:` prefix and all; the readers strip it).
        return dict(entry)

    return list(await asyncio.gather(*(asyncio.to_thread(fetch, e) for e in entries or [])))


def page_out(entry: dict[str, Any]) -> dict[str, Any]:
    """One page as a client gets it: a URL to load it from, its media
    type, and — for the client's URL cache — a stable `id` and how many
    seconds the URL works for. Never the bytes."""
    media_type = str(entry.get("media_type") or "image/jpeg")
    out: dict[str, Any] = {"media_type": media_type, "filename": entry.get("filename")}
    if "key" in entry:
        key = str(entry["key"])
        out["url"] = backend().url(key, PRESIGN_SECONDS)
        out["id"] = key.rsplit("/", 1)[-1].split(".", 1)[0]
        out["expires_in"] = PRESIGN_SECONDS
    else:
        # INLINE: served as a data: URL until the backfill moves it, so
        # clients render every page the same way.
        data = str(entry.get("data") or "")
        out["url"] = data if data.startswith("data:") else f"data:{media_type};base64,{data}"
        out["id"] = None
        out["expires_in"] = None
    return out


def pages_out(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    return None if entries is None else [page_out(e) for e in entries]


# Deletes in flight at once: a course's worth of pages goes in seconds
# without taking every worker thread.
_DELETE_CONCURRENCY = 16


async def delete_pages(entries: list[dict[str, Any]]) -> None:
    """Best-effort removal of pages: ones a failed request uploaded, or
    the pages of submissions whose delete has COMMITTED. Never raises — a
    page that won't delete is logged by key (never a URL), and the request
    that removed its row still succeeds. INLINE entries have nothing to
    remove."""
    keys = [entry["key"] for entry in entries if "key" in entry]
    if not keys:
        return
    gate = asyncio.Semaphore(_DELETE_CONCURRENCY)

    async def delete(key: str) -> None:
        async with gate:
            try:
                await asyncio.to_thread(backend().delete, key)
            except Exception:  # noqa: BLE001 — an orphaned object is harmless; the error isn't the caller's
                logger.warning("couldn't delete photo object %s", key)

    await asyncio.gather(*(delete(k) for k in keys))


# Every bucket key in the given submissions' `files` and their earlier
# attempts' — read out in SQL, so a course still holding inline (pre-
# backfill) pages isn't loaded into memory to find none.
_KEYS_SQL = text("""
    SELECT e ->> 'key' FROM (
        SELECT files FROM submissions WHERE id = ANY(:ids)
        UNION ALL
        SELECT files FROM submission_attempts WHERE submission_id = ANY(:ids)
    ) AS f, jsonb_array_elements(
        CASE WHEN json_typeof(f.files) = 'array' THEN f.files::jsonb ELSE '[]'::jsonb END
    ) AS e
    WHERE e ? 'key'
""")


async def pages_of_submissions(
    db: AsyncSession, *where: ColumnElement[bool],
) -> list[dict[str, Any]]:
    """The bucket pages of the submissions matching `where` (and of their
    earlier attempts), to pass to `delete_pages` once the rows' delete
    has committed. Call it BEFORE deleting: after, the rows are gone."""
    from api.models.assignment import Submission

    ids = list((await db.execute(select(Submission.id).where(*where))).scalars())
    if not ids:
        return []
    keys = (await db.execute(_KEYS_SQL, {"ids": ids})).scalars()
    return [{"key": k} for k in keys]


async def pages_of_user(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """`pages_of_submissions` for every submission that deleting this user
    cascades to: their own turn-ins, the turn-ins on homework they own
    (assignments.teacher_id cascades), and their preview student's
    (users.preview_owner_id cascades)."""
    from api.models.assignment import Assignment, Submission
    from api.models.user import User

    users = select(User.id).where(or_(User.id == user_id, User.preview_owner_id == user_id))
    return await pages_of_submissions(
        db,
        or_(
            Submission.student_id.in_(users),
            Submission.assignment_id.in_(select(Assignment.id).where(Assignment.teacher_id.in_(users))),
        ),
    )
