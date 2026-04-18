"""Teacher routes — aggregator for sub-modules."""

from fastapi import APIRouter

from api.routes.teacher_assignments import router as assignments_router
from api.routes.teacher_courses import router as courses_router
from api.routes.teacher_documents import router as documents_router
from api.routes.teacher_grades import router as grades_router
from api.routes.teacher_preferences import router as preferences_router
from api.routes.teacher_preview import router as preview_router
from api.routes.teacher_question_bank import router as question_bank_router
from api.routes.teacher_sections import router as sections_router
from api.routes.teacher_units import router as units_router
from api.routes.teacher_visibility import router as visibility_router

router = APIRouter(prefix="/teacher", tags=["teacher"])

router.include_router(courses_router)
router.include_router(sections_router)
router.include_router(documents_router)
router.include_router(units_router)
router.include_router(assignments_router)
router.include_router(visibility_router)
router.include_router(question_bank_router)
router.include_router(preview_router)
router.include_router(grades_router)
router.include_router(preferences_router)
