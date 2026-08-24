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
    client_error,
    contact_lead,
    course,
    golden_case,
    grading_job,
    harness_run,
    integrity_check,
    lead_meeting,
    lead_note,
    llm_call,
    practice_activity,
    quality_score,
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
    unit,
    user,
    visibility,
    work_submission,
)
