"""Image extraction endpoints: extract problems from photos."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.entitlements import Entitlement, check_entitlement
from api.core.image_extract import extract_problems_from_image
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.models.user import User
from api.middleware.rate_limit import limiter
from api.schemas.image import ImageExtractRequest, ImageExtractResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/image", tags=["image"])


@router.post("/extract", response_model=ImageExtractResponse)
@limiter.limit("10/minute")
async def extract(
    request: Request,
    body: ImageExtractRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> ImageExtractResponse:
    """Extract problems from a photo of a worksheet, textbook, etc."""
    await check_entitlement(db, user, Entitlement.IMAGE_SCAN)
    try:
        result = await extract_problems_from_image(
            body.image_base64, user_id=str(user.id),
            subject=body.subject,
        )
    except ValueError:
        logger.exception("Image extraction returned invalid format")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not extract problems from this image",
        )
    except RuntimeError:
        logger.exception("Image extraction failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to extract problems from image",
        )

    return ImageExtractResponse(
        problems=result["problems"],
        confidence=result["confidence"],
    )
