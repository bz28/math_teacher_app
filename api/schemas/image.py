"""Schemas for image extraction endpoints."""

from pydantic import BaseModel, Field, field_validator

from api.core.subjects import VALID_SUBJECTS

# ~7MB base64 encodes to ~5MB decoded
MAX_BASE64_LENGTH = 7 * 1024 * 1024


class ImageExtractRequest(BaseModel):
    image_base64: str = Field(
        ...,
        max_length=MAX_BASE64_LENGTH,
        description="Base64-encoded image (JPEG/PNG)",
    )
    subject: str = Field("math")

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


class ImageExtractResponse(BaseModel):
    problems: list[str] = Field(..., description="Extracted problems")
    confidence: str = Field(..., description="Extraction confidence: high, medium, or low")


class ImageExtractObjectivesResponse(BaseModel):
    topics: list[str] = Field(..., description="Extracted learning objectives / topics")
    confidence: str = Field(..., description="Extraction confidence: high, medium, or low")
