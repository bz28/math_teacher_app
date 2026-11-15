"""Homework photos live in the photo bucket, not in Postgres.

Exercised against a mocked S3 (moto) through the real `S3Backend`, so the
boto3 calls the app makes in production are the ones under test:

- the write path stores keys, never bytes, and the bucket holds the
  decoded pages with their content type;
- the read helper hands the reader the exact bytes that were uploaded;
- every response that shows photos carries presigned URLs, not base64;
- a failed upload fails the turn-in (503) and leaves nothing behind.
"""

from __future__ import annotations

import base64
import io
import uuid
from collections.abc import Iterator
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
from api.routes.school_student_practice import drain_integrity_background_tasks
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


async def test_deleting_pages_batches_them_through_delete_objects(
    s3: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A course's worth of pages goes in a few DeleteObjects calls, not one
    request per page; a key that's already gone isn't an error."""
    stored = await photo_store.store_pages(uuid.uuid4(), [{"data": PAGE_PNG, "media_type": "image/png"}] * 5)
    keep = await photo_store.store_pages(uuid.uuid4(), [{"data": PAGE_PNG, "media_type": "image/png"}])
    monkeypatch.setattr(photo_store, "DELETE_BATCH", 2)
    store = photo_store.backend()
    calls: list[int] = []
    real = store.delete_many

    def counting(keys: list[str]) -> list[str]:
        calls.append(len(keys))
        return real(keys)

    monkeypatch.setattr(store, "delete_many", counting)
    await photo_store.delete_pages([*stored, {"key": "submissions/gone/x.png"}])
    assert calls == [2, 2, 2]
    assert _objects(s3) == [keep[0]["key"]]


# ── read helper ──


async def test_load_pages_gives_back_the_uploaded_bytes(s3: Any) -> None:
    pages = [{"data": PAGE_JPEG, "media_type": "image/jpeg"}, {"data": PAGE_PNG, "media_type": "image/png"}]
    stored = await photo_store.store_pages(uuid.uuid4(), pages)

    loaded = await photo_store.load_pages(stored)
    assert [p["data"] for p in loaded] == [PAGE_JPEG, PAGE_PNG]
    assert [p["media_type"] for p in loaded] == ["image/jpeg", "image/png"]
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
