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

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Structured logging with correlation IDs
    app.add_middleware(LoggingMiddleware)
