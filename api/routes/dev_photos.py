"""Serves homework photos from local disk in development and tests — the
stand-in for the bucket's presigned URLs when PHOTO_BUCKET is unset (see
api/core/photo_store.py). 404 whenever the store is a real bucket, so in
production this route serves nothing."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from api.core import photo_store

router = APIRouter()


@router.get("/dev/photos/{key:path}", include_in_schema=False)
async def get_dev_photo(key: str, expires: int = Query(...), sig: str = Query(...)) -> Response:
    store = photo_store.backend() if photo_store.configured() else None
    if not isinstance(store, photo_store.LocalBackend) or not store.verify(key, expires, sig):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        body = store.get(key)
    except (photo_store.PhotoStoreError, OSError) as e:
        raise HTTPException(status_code=404, detail="Not found") from e
    ext = key.rsplit(".", 1)[-1]
    media_type = next((m for m, e in photo_store.EXTENSIONS.items() if e == ext), "application/octet-stream")
    return Response(body, media_type=media_type, headers={"Cache-Control": "private, max-age=86400, immutable"})
