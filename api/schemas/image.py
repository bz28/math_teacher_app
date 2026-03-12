"""Schemas for image extraction endpoints."""

from pydantic import BaseModel, Field


class ImageExtractRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded image (JPEG/PNG)")


class ImageExtractResponse(BaseModel):
    problems: list[str] = Field(..., description="Extracted math problems")
    confidence: str = Field(..., description="Extraction confidence: high, medium, or low")
