"""Image extraction endpoints: extract problems from photos."""

from fastapi import APIRouter, Depends, HTTPException, status

from api.core.image_extract import extract_problems_from_image
from api.middleware.auth import get_current_user_full
from api.models.user import User
from api.schemas.image import ImageExtractRequest, ImageExtractResponse

router = APIRouter(prefix="/image", tags=["image"])


@router.post("/extract", response_model=ImageExtractResponse)
async def extract(
    body: ImageExtractRequest,
    user: User = Depends(get_current_user_full),
) -> ImageExtractResponse:
    """Extract problems from a photo of a worksheet, textbook, etc."""
    try:
        result = await extract_problems_from_image(
            body.image_base64, user_id=str(user.id),
            subject=body.subject,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to extract problems from image",
        )

    return ImageExtractResponse(
        problems=result["problems"],
        confidence=result["confidence"],
    )
