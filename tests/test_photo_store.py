"""Homework photos live in the photo bucket, not in Postgres.

Exercised against a mocked S3 (moto) through the real `S3Backend`, so the
boto3 calls the app makes in production are the ones under test:

- the write path stores keys, never bytes, and the bucket holds the
  decoded pages with their content type;
- the read helper hands the reader identical bytes for a stored page and
  for a not-yet-moved inline one;
- every response that shows photos carries presigned URLs, not base64;
- a failed upload fails the turn-in (503) and leaves nothing behind;
- the backfill (scripts/backfill_photo_bucket.py): dry run touches
  nothing, --go moves and verifies, a rerun is a no-op, and a page that
  doesn't verify keeps its row's inline data.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

import boto3
import pytest
from httpx import AsyncClient
from moto import mock_aws
from PIL import Image
from sqlalchemy import text

from api.core import photo_store
from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionAttempt
from api.routes.school_student_practice import drain_integrity_background_tasks
from scripts.backfill_photo_bucket import backfill
from tests.conftest import PAGE_PNG

BUCKET = "test-submission-photos"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _jpeg(size: tuple[int, int] = (800, 600), color: str = "white") -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


PAGE_JPEG = _jpeg()


@pytest.fixture
def s3() -> Iterator[Any]:
    """The app's store, pointed at a mocked bucket. Yields a raw boto3
    client for the tests to look inside the bucket with."""
    with mock_aws():
        raw = boto3.client("s3", region_name="us-east-1")
        raw.create_bucket(Bucket=BUCKET)
        store = photo_store.S3Backend(
            bucket=BUCKET, endpoint="", region="us-east-1",
            access_key_id="testing", secret_access_key="testing",
        )
        photo_store.set_backend(store)
        try:
            yield raw
        finally:
            photo_store.set_backend(None)


def _objects(s3: Any) -> list[str]:
    return [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]


async def _files(sid: str, table: str = "submissions") -> Any:
    async with get_session_factory()() as s:
        return (await s.execute(text(f"SELECT files FROM {table} WHERE id = :id"), {"id": sid})).scalar_one()


async def _submit(client: AsyncClient, world: dict[str, Any], files: list[str]) -> Any:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]), json={"files": files},
    )
    await drain_integrity_background_tasks()
    return r


# ── write path ──


async def test_submit_stores_keys_and_the_bucket_holds_the_pages(
    client: AsyncClient, world: dict[str, Any], s3: Any,
) -> None:
    r = await _submit(client, world, [PAGE_PNG, PAGE_JPEG])
    assert r.status_code == 200, r.text
    sid = r.json()["submission_id"]

    files = await _files(sid)
    assert [set(f) for f in files] == [{"key", "media_type"}] * 2
    assert all("data" not in f for f in files)
    for f, sent in zip(files, [PAGE_PNG, PAGE_JPEG], strict=True):
        assert f["key"].startswith(f"submissions/{sid}/")
        obj = s3.get_object(Bucket=BUCKET, Key=f["key"])
        assert obj["Body"].read() == base64.b64decode(sent)
        assert obj["ContentType"] == f["media_type"]
    assert [f["media_type"] for f in files] == ["image/png", "image/jpeg"]
    # Unguessable: a random 128-bit name, never the same twice.
    names = {f["key"].rsplit("/", 1)[1].split(".")[0] for f in files}
    assert len(names) == 2 and all(len(n) == 32 for n in names)


async def test_a_failed_upload_fails_the_turn_in_and_leaves_nothing(
    client: AsyncClient, world: dict[str, Any], s3: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = photo_store.backend()
    real_put = store.put
    calls = {"n": 0}

    def flaky_put(key: str, body: bytes, media_type: str) -> None:
        calls["n"] += 1
        if media_type == "image/jpeg":
            raise ConnectionError("bucket unreachable")
        real_put(key, body, media_type)

    monkeypatch.setattr(store, "put", flaky_put)
    r = await _submit(client, world, [PAGE_PNG, PAGE_JPEG])
    assert r.status_code == 503, r.text
    assert "photos" in r.json()["detail"]
    assert calls["n"] == 2
    # No row, and the page that did land was removed.
    async with get_session_factory()() as s:
        n = (await s.execute(
            text("SELECT count(*) FROM submissions WHERE assignment_id = :a AND student_id = :s"),
            {"a": world["assignment_id"], "s": world["student_id"]},
        )).scalar_one()
    assert n == 0
    assert _objects(s3) == []


async def test_a_retake_stores_new_keys_and_its_attempt_keeps_the_old_ones(
    client: AsyncClient, world: dict[str, Any], s3: Any,
) -> None:
    r = await _submit(client, world, [PAGE_PNG])
    sid = r.json()["submission_id"]
    first = await _files(sid)
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/flag-extraction",
        headers=_auth(world["student_token"]), json={},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/school/student/submissions/{sid}/retake",
        headers=_auth(world["student_token"]), json={"files": [PAGE_JPEG]},
    )
    assert r.status_code == 200, r.text
    now = await _files(sid)
    assert "key" in now[0] and now[0]["key"] != first[0]["key"]
    async with get_session_factory()() as s:
        kept = (await s.execute(
            text("SELECT files FROM submission_attempts WHERE submission_id = :id"), {"id": sid},
        )).scalar_one()
    assert kept == first
    assert sorted(_objects(s3)) == sorted([first[0]["key"], now[0]["key"]])


# ── read helper ──


async def test_load_pages_gives_identical_bytes_for_stored_and_inline_pages(s3: Any) -> None:
    sid = uuid.uuid4()
    pages = [{"data": PAGE_JPEG, "media_type": "image/jpeg"}, {"data": PAGE_PNG, "media_type": "image/png"}]
    stored = await photo_store.store_pages(sid, pages)
    inline_with_prefix = [{"data": f"data:image/jpeg;base64,{PAGE_JPEG}", "media_type": "image/jpeg"}]

    from_bucket = await photo_store.load_pages(stored)
    from_rows = await photo_store.load_pages(pages)
    assert [p["data"] for p in from_bucket] == [p["data"] for p in from_rows] == [PAGE_JPEG, PAGE_PNG]
    assert [p["media_type"] for p in from_bucket] == ["image/jpeg", "image/png"]
    assert (await photo_store.load_pages(inline_with_prefix)) == inline_with_prefix
    assert await photo_store.load_pages(None) == []


async def test_the_reader_gets_the_pages_from_the_bucket(s3: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """`extract_student_work_from_pages` resolves stored entries to the
    original bytes before building the Vision request."""
    from api.core import integrity_ai

    stored = await photo_store.store_pages(uuid.uuid4(), [{"data": PAGE_JPEG, "media_type": "image/jpeg"}])
    seen: list[Any] = []

    async def fake_vision(content: list[dict[str, Any]], *_: Any, **__: Any) -> dict[str, Any]:
        seen.extend(content)
        return {"steps": [], "final_answers": [], "visual_work": [], "confidence": 0.9}

    monkeypatch.setattr(integrity_ai, "call_claude_vision", fake_vision)
    await integrity_ai.extract_student_work_from_pages(stored)
    images = [b for b in seen if b.get("type") == "image"]
    assert len(images) == 1
    assert images[0]["source"]["data"]  # a real page was sent, not an empty one


# ── serving ──


def _assert_presigned(f: dict[str, Any]) -> None:
    assert "data" not in f
    url = urlparse(f["url"])
    assert url.scheme == "https"
    q = parse_qs(url.query)
    assert "X-Amz-Signature" in q
    assert q["X-Amz-Expires"] == [str(photo_store.PRESIGN_SECONDS)]
    assert f["expires_in"] == photo_store.PRESIGN_SECONDS
    assert f["id"] and f["id"] in url.path


async def test_responses_carry_presigned_urls_not_base64(
    client: AsyncClient, world: dict[str, Any], s3: Any,
) -> None:
    r = await _submit(client, world, [PAGE_PNG, PAGE_JPEG])
    sid = r.json()["submission_id"]

    student = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert student.status_code == 200, student.text
    teacher = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert teacher.status_code == 200, teacher.text
    for body in (student.json(), teacher.json()):
        assert [f["media_type"] for f in body["files"]] == ["image/png", "image/jpeg"]
        for f in body["files"]:
            _assert_presigned(f)
    # The same page has the same id in every response, whatever its URL.
    assert [f["id"] for f in student.json()["files"]] == [f["id"] for f in teacher.json()["files"]]
    # No photo bytes in either payload.
    assert PAGE_JPEG[:200] not in student.text and PAGE_JPEG[:200] not in teacher.text
    assert len(student.content) < 10_000


async def test_the_originals_endpoint_serves_urls(
    client: AsyncClient, world: dict[str, Any], s3: Any,
) -> None:
    r = await _submit(client, world, [PAGE_PNG])
    sid = r.json()["submission_id"]
    await client.post(f"/v1/school/student/submissions/{sid}/flag-extraction",
                      headers=_auth(world["student_token"]), json={})
    r = await client.post(f"/v1/school/student/submissions/{sid}/retake",
                          headers=_auth(world["student_token"]), json={"files": [PAGE_JPEG]})
    assert r.status_code == 200, r.text
    r = await client.get(f"/v1/teacher/submissions/{sid}/attempts/1/files", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    (f,) = r.json()["files"]
    _assert_presigned(f)
    assert f["media_type"] == "image/png"


async def test_a_row_the_backfill_hasnt_moved_is_served_as_a_data_url(
    client: AsyncClient, world: dict[str, Any], s3: Any,
) -> None:
    sid = await _inline_submission(world)
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    (f,) = r.json()["files"]
    assert f["url"] == f"data:image/jpeg;base64,{PAGE_JPEG}"
    assert f["id"] is None and f["expires_in"] is None


async def test_the_dev_route_serves_a_signed_local_page_and_nothing_else(
    client: AsyncClient, tmp_path: Any,
) -> None:
    store = photo_store.LocalBackend(root=tmp_path, base_url="http://test", secret="s")
    photo_store.set_backend(store)
    try:
        (entry,) = await photo_store.store_pages(uuid.uuid4(), [{"data": PAGE_PNG, "media_type": "image/png"}])
        url = photo_store.page_out(entry)["url"]
        r = await client.get(url.removeprefix("http://test"))
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content == base64.b64decode(PAGE_PNG)
        tampered = url.replace("sig=", "sig=0")
        assert (await client.get(tampered.removeprefix("http://test"))).status_code == 404
        traversal = f"/v1/dev/photos/submissions/../../etc/passwd?expires=9999999999&sig={store.signature('x', 1)}"
        assert (await client.get(traversal)).status_code == 404
    finally:
        photo_store.set_backend(None)


# ── backfill ──


async def _inline_submission(world: dict[str, Any], pages: list[str] | None = None) -> str:
    """A pre-move row: pages inline, as every row written before this was."""
    pages = pages or [PAGE_JPEG]
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM submissions WHERE assignment_id = :a AND student_id = :s"),
                        {"a": world["assignment_id"], "s": world["student_id"]})
        section_id = (await s.execute(
            text("SELECT section_id FROM assignment_sections WHERE assignment_id = :a"), {"a": world["assignment_id"]},
        )).scalar_one()
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["student_id"], section_id=section_id,
            status="submitted", files=[{"data": p, "media_type": "image/jpeg"} for p in pages],
            submitted_at=datetime.now(UTC), is_late=False,
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionAttempt(
            submission_id=sub.id, number=1, reason="retake",
            files=[{"data": _jpeg(color="gray"), "media_type": "image/jpeg", "filename": "first.jpg"}],
            submitted_at=datetime.now(UTC), is_late=False, replaced_at=datetime.now(UTC),
        ))
        await s.commit()
        return str(sub.id)


async def _attempt_files(sid: str) -> Any:
    async with get_session_factory()() as s:
        return (await s.execute(
            text("SELECT files FROM submission_attempts WHERE submission_id = :id"), {"id": sid},
        )).scalar_one()


async def _inline_rows() -> int:
    async with get_session_factory()() as s:
        return int((await s.execute(text(
            "SELECT (SELECT count(*) FROM submissions WHERE jsonb_path_exists(files::jsonb, '$[*].data'))"
            " + (SELECT count(*) FROM submission_attempts WHERE jsonb_path_exists(files::jsonb, '$[*].data'))"
        ))).scalar_one())


async def test_backfill_dry_run_go_and_rerun(world: dict[str, Any], s3: Any) -> None:
    sid = await _inline_submission(world, [PAGE_JPEG, _jpeg(color="black")])
    before_sub, before_att = await _files(sid), await _attempt_files(sid)
    factory = get_session_factory()

    dry = await backfill(factory, photo_store.backend(), go=False)
    assert dry.moved == 0 and dry.rows >= 2
    assert await _files(sid) == before_sub and await _attempt_files(sid) == before_att
    assert _objects(s3) == []

    done = await backfill(factory, photo_store.backend(), go=True)
    assert not done.failed
    assert await _inline_rows() == 0
    after_sub, after_att = await _files(sid), await _attempt_files(sid)
    for before, after in ((before_sub, after_sub), (before_att, after_att)):
        assert len(after) == len(before)
        for b, a in zip(before, after, strict=True):
            assert "data" not in a
            assert a["key"].startswith(f"submissions/{sid}/")
            assert a["media_type"] == b["media_type"]
            assert a.get("filename") == b.get("filename")  # other fields kept
            assert s3.get_object(Bucket=BUCKET, Key=a["key"])["Body"].read() == base64.b64decode(b["data"])
    # The reader gets the very bytes it got before the move.
    assert [p["data"] for p in await photo_store.load_pages(after_sub)] == [p["data"] for p in before_sub]

    again = await backfill(factory, photo_store.backend(), go=True)
    assert again.rows == 0 and again.moved == 0
    assert await _files(sid) == after_sub


async def test_backfill_keeps_the_inline_data_of_a_page_that_doesnt_verify(
    world: dict[str, Any], s3: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    sid = await _inline_submission(world)
    before = await _files(sid)
    store = photo_store.backend()
    real_get = store.get
    bad_key = None

    def corrupt_get(key: str) -> bytes:
        nonlocal bad_key
        if key.startswith(f"submissions/{sid}/") and bad_key in (None, key):
            bad_key = key
            return real_get(key)[:-1] + b"\x00"
        return real_get(key)

    monkeypatch.setattr(store, "get", corrupt_get)
    tally = await backfill(get_session_factory(), store, go=True)
    assert any(sid in f for f in tally.failed)
    assert await _files(sid) == before  # inline data kept, untouched


async def test_backfill_leaves_a_row_that_changed_mid_move(
    world: dict[str, Any], s3: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retake landing while the old pages upload must win: the backfill
    never writes its rewrite over photos it didn't read."""
    import scripts.backfill_photo_bucket as bf

    sid = await _inline_submission(world)
    retaken = [{"key": f"submissions/{sid}/retaken.jpg", "media_type": "image/jpeg"}]
    real_move = bf._move_page

    async def move_then_retake(store: Any, key: str, raw: bytes, media_type: str) -> None:
        await real_move(store, key, raw, media_type)
        if key.startswith(f"submissions/{sid}/"):
            async with get_session_factory()() as s:
                await s.execute(text("UPDATE submissions SET files = CAST(:f AS json) WHERE id = :id"),
                                {"f": json.dumps(retaken), "id": sid})
                await s.commit()

    monkeypatch.setattr(bf, "_move_page", move_then_retake)
    tally = await backfill(get_session_factory(), photo_store.backend(), go=True)
    assert any(sid in row for row in tally.skipped)
    assert await _files(sid) == retaken


async def test_backfill_refuses_without_the_bucket(tmp_path: Any) -> None:
    store = photo_store.LocalBackend(root=tmp_path, base_url="http://test", secret="s")
    with pytest.raises(SystemExit, match="REFUSING"):
        await backfill(get_session_factory(), store, go=True)


def test_backfill_keys_are_derived_from_the_bytes() -> None:
    from scripts.backfill_photo_bucket import _key

    raw = base64.b64decode(PAGE_JPEG)
    key = _key("abc", raw, "image/jpeg")
    assert key == f"submissions/abc/{hashlib.sha256(raw).hexdigest()[:32]}.jpg"
    assert key == _key("abc", raw, "image/jpeg")
