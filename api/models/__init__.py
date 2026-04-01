# Import all models so SQLAlchemy registers them with Base.metadata
from api.models import (  # noqa: F401
    course,
    llm_call,
    promo,
    quality_score,
    section,
    section_enrollment,
    session,
    user,
    work_submission,
)
