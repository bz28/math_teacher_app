"""Schemas for image extraction endpoints."""

from pydantic import BaseModel, Field

# ~7MB base64 encodes to ~5MB decoded
MAX_BASE64_LENGTH = 7 * 1024 * 1024


class ImageExtractRequest(BaseModel):
    image_base64: str = Field(
        ...,
        max_length=MAX_BASE64_LENGTH,
        description="Base64-encoded image (JPEG/PNG)",
    )


class ImageExtractResponse(BaseModel):
    problems: list[str] = Field(..., description="Extracted math problems")
    confidence: str = Field(..., description="Extraction confidence: high, medium, or low")
