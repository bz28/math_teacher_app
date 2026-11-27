"""Admin dashboard routes — thin aggregator for sub-modules."""

from fastapi import APIRouter

from api.routes.admin_assignments import router as assignments_router
from api.routes.admin_extraction_quality import (
    router as extraction_quality_router,
)
from api.routes.admin_generation import router as generation_router
from api.routes.admin_grading_quality import router as grading_quality_router
from api.routes.admin_leads import router as leads_router
from api.routes.admin_llm import router as llm_router
from api.routes.admin_llm_attention import router as llm_attention_router
from api.routes.admin_reports import router as reports_router
from api.routes.admin_school_overview import router as school_overview_router
from api.routes.admin_schools import router as schools_router
from api.routes.admin_spend import router as spend_router
from api.routes.admin_students import router as students_router
from api.routes.admin_submissions import router as submissions_router
from api.routes.admin_unit_economics import router as unit_economics_router
from api.routes.admin_users import router as users_router

router = APIRouter(prefix="/admin", tags=["admin"])

router.include_router(assignments_router)
router.include_router(extraction_quality_router)
router.include_router(generation_router)
router.include_router(grading_quality_router)
router.include_router(leads_router)
router.include_router(llm_router)
router.include_router(llm_attention_router)
router.include_router(reports_router)
router.include_router(school_overview_router)
router.include_router(schools_router)
router.include_router(spend_router)
router.include_router(students_router)
router.include_router(submissions_router)
router.include_router(unit_economics_router)
router.include_router(users_router)
