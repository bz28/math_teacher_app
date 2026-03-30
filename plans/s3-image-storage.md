# S3 Image Storage for Problem Images

## Problem
Cropped problem images are client-side only — lost when user leaves the session. History shows no images. Need persistent image storage that doesn't bloat the DB.

## Solution
Upload cropped images directly to S3 via presigned URLs. Store only the S3 key on the session model.

## Architecture

### Upload Flow
1. Frontend crops image (already done)
2. Frontend requests presigned PUT URL: `GET /api/upload-url?filename=session-123.jpg`
3. Backend generates presigned S3 PUT URL (5 min expiry, scoped to user path)
4. Frontend uploads directly to S3 (image never touches our backend)
5. Frontend sends S3 key to backend when creating session: `{ problem, image_key: "images/user-123/session-456.jpg" }`

### Display Flow
1. Session response includes `image_url` field
2. Backend generates presigned GET URL on the fly (1 hour expiry) from stored `image_key`
3. Frontend displays as normal `<img src={url}>`

## Backend Changes

### New endpoint: `GET /upload-url`
```python
@router.get("/upload-url")
async def get_upload_url(current_user, filename: str):
    key = f"images/{current_user.user_id}/{uuid4()}-{filename}"
    url = s3.generate_presigned_url("put_object", Params={
        "Bucket": BUCKET, "Key": key, "ContentType": "image/jpeg"
    }, ExpiresIn=300)
    return {"url": url, "key": key}
```

### Session model
- Add `image_key: str | None` column (nullable, ~50 chars max)
- Migration: `ALTER TABLE sessions ADD COLUMN image_key VARCHAR(200)`

### Session response serialization
```python
if session.image_key:
    image_url = s3.generate_presigned_url("get_object", Params={
        "Bucket": BUCKET, "Key": session.image_key
    }, ExpiresIn=3600)
```

### New util: `api/core/s3.py`
- Initialize boto3 S3 client from env vars
- `generate_upload_url(user_id, filename) -> (url, key)`
- `generate_download_url(key) -> url`

## Infrastructure Setup

### S3 Bucket
- Create bucket (e.g., `veradic-problem-images`)
- CORS policy: allow PUT from app domains
- Lifecycle rule: auto-delete after 90 days (optional, saves cost)
- Block public access (presigned URLs only)

### Environment Variables
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET` (e.g., `veradic-problem-images`)
- `AWS_REGION` (e.g., `us-east-1`)

### IAM Policy
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject"],
  "Resource": "arn:aws:s3:::veradic-problem-images/*"
}
```

## Frontend Changes
- After cropping, upload to S3 before creating session
- Store `image_key` instead of base64 in `problemImages`
- Display images via presigned GET URLs from session response

## Cost
- Storage: $0.023/GB/month (~$0.01/month for 500 images)
- Requests: $0.0004/1000 requests (~free)
- Data transfer: $0.09/GB (first 10GB/month free)

## Dependencies
- `boto3` (Python, backend)
- No new frontend deps (uses fetch for upload)

## Files to Create/Modify
- `api/core/s3.py` — new, S3 client wrapper
- `api/routes/upload.py` — new, presigned URL endpoint
- `api/models/session.py` — add `image_key` column
- `api/schemas/session.py` — add `image_key` to create, `image_url` to response
- `api/routes/session.py` — generate download URLs in response
- Frontend stores + API clients — swap base64 for S3 URLs
- Alembic migration for new column
