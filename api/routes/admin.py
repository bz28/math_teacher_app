"""Admin dashboard routes — thin aggregator for sub-modules."""

from fastapi import APIRouter

from api.routes.admin_leads import router as leads_router
from api.routes.admin_llm import router as llm_router
from api.routes.admin_overview import router as overview_router
from api.routes.admin_quality import router as quality_router
from api.routes.admin_schools import router as schools_router
from api.routes.admin_sessions import router as sessions_router
from api.routes.admin_users import router as users_router

router = APIRouter(prefix="/admin", tags=["admin"])

router.include_router(leads_router)
router.include_router(llm_router)
router.include_router(overview_router)
router.include_router(quality_router)
router.include_router(schools_router)
router.include_router(sessions_router)
router.include_router(users_router)
