# Import every model module so SQLAlchemy registers all tables on
# Base.metadata. This is the single source of truth for "all models" —
# Alembic's env.py imports `api.models` (this package) rather than
# hand-maintaining its own list, so a model can never silently drift out
# of the autogenerate metadata (which would make autogenerate emit
# DROP TABLE for the missing tables). test_models_metadata_complete.py
# asserts this list stays in sync with the files in this directory.
from api.models import (  # noqa: F401
    activity_log,
    app_stat,
    assignment,
    course,
    extraction_job,
    grading_job,
    integrity_check,
    llm_call,
    llm_payload,
    practice_activity,
    question_bank,
    question_edit,
    school,
    section,
    section_enrollment,
    section_invite,
    session,
    stripe_event,
    student_record_access_log,
    teacher_invite,
    teacher_report,
    unit,
    user,
    visibility,
    work_submission,
)
