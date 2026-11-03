"""FastAPI application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.auth.router import router as auth_router
from app.businesses.router import router as businesses_router
from app.common.exceptions import AppError, ErrorCode
from app.common.responses import error_content
from app.core.config import get_settings
from app.core.csrf import CSRFMiddleware
from app.core.logging import configure_logging, log_event
from app.core.security import dummy_password_hash
from app.core.security_headers import SecurityHeadersMiddleware
from app.kpis.router import router as kpis_router
from app.lead_fields.router import router as lead_fields_router
from app.leads.router import router as leads_router
from app.permissions.router import router as permissions_router
from app.pipeline.router import router as pipeline_router
from app.projects.router import router as projects_router
from app.roles.router import router as roles_router
from app.team.router import router as team_router
from app.users.router import router as users_router

logger = logging.getLogger("app.main")


def _validation_details(exc: RequestValidationError) -> list[dict[str, str]]:
    details: list[dict[str, str]] = []
    for error in exc.errors():
        loc = [str(part) for part in error.get("loc", []) if part not in {"body", "query", "path"}]
        field = ".".join(loc) or "request"
        error_type = str(error.get("type", "invalid"))
        code = "INVALID"
        message = "Invalid value."
        if error_type == "missing":
            code = "REQUIRED"
            message = "This field is required."
        elif "email" in error_type or (field == "email" and error_type != "missing"):
            code = "INVALID_EMAIL"
            message = "Enter a valid email address."
        elif field == "full_name":
            code = "TOO_SHORT"
            message = "Full name must be at least 2 characters."
        elif field == "preferred_language":
            code = "UNSUPPORTED_LANGUAGE"
            message = "Language must be English, Marathi, or Hindi."
        details.append({"field": field, "code": code, "message": message})
    return details


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    dummy_password_hash()
    if get_settings().app_env == "production" and get_settings().email_backend == "file":
        log_event(logger, "email_backend_not_for_production")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Aadi CRM API",
        version="1.0.0",
        summary="Authentication, access management, and leads API for Aadi CRM",
        description=(
            "Cookie-based authentication foundation. Access and refresh tokens are HttpOnly cookies. "
            "Authorization uses database roles and permissions. "
            "Unsafe requests require an X-CSRF-Token header matching the csrf_token cookie."
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_content(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_content(
                ErrorCode.VALIDATION_ERROR,
                "Validation failed.",
                _validation_details(exc),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            code, message = ErrorCode.NOT_FOUND, "Resource not found."
        elif exc.status_code == 405:
            code, message = ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."
        else:
            code, message = ErrorCode.INTERNAL_ERROR, "Request could not be processed."
        return JSONResponse(status_code=exc.status_code, content=error_content(code, message))

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        log_event(logger, "unhandled_error", error_type=type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content=error_content(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred."),
        )

    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Accept", "Accept-Language"],
    )
    @app.get("/api/v1/health", tags=["Health"], include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
    app.include_router(businesses_router, prefix="/api/v1/businesses", tags=["Businesses"])
    app.include_router(users_router, prefix="/api/v1/users", tags=["Users"])
    app.include_router(leads_router, prefix="/api/v1/leads", tags=["Leads"])
    app.include_router(kpis_router, prefix="/api/v1/kpis", tags=["KPIs"])
    app.include_router(lead_fields_router, prefix="/api/v1/lead-fields", tags=["Lead Fields"])
    app.include_router(pipeline_router, prefix="/api/v1/pipeline-stages", tags=["Pipeline"])
    app.include_router(projects_router, prefix="/api/v1/projects", tags=["Projects"])
    app.include_router(team_router, prefix="/api/v1/team", tags=["Team"])
    app.include_router(roles_router, prefix="/api/v1/roles", tags=["Roles"])
    app.include_router(permissions_router, prefix="/api/v1/permissions", tags=["Permissions"])
    return app


app = create_app()
