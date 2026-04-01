from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.middleware.logging import LoggingMiddleware
from api.middleware.security import RequestSizeLimitMiddleware, SecurityHeadersMiddleware


def configure_middleware(app: FastAPI) -> None:
    # Order matters: outermost middleware runs first

    # Request size limit
    app.add_middleware(RequestSizeLimitMiddleware, max_size=settings.max_request_size)

    # Security headers
    app.add_middleware(SecurityHeadersMiddleware)

    # CORS — allow configured origins + this project's Vercel preview URLs only
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https://math-teacher-app-eight(-[a-z0-9]+)?\.vercel\.app",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Structured logging with correlation IDs
    app.add_middleware(LoggingMiddleware)
