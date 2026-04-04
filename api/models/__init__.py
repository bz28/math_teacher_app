# Import all models so SQLAlchemy registers them with Base.metadata
from api.models import (  # noqa: F401
    contact_lead,
    course,
    llm_call,
    promo,
    quality_score,
    school,
    section,
    section_enrollment,
    session,
    teacher_invite,
    unit,
    user,
    work_submission,
)
