# Import all models so SQLAlchemy registers them with Base.metadata
from api.models import (  # noqa: F401
    app_stat,
    assignment,
    contact_lead,
    course,
    llm_call,
    promo,
    school,
    section,
    section_enrollment,
    section_invite,
    session,
    teacher_invite,
    unit,
    user,
    visibility,
    work_submission,
)
