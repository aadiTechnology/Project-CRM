"""HttpOnly cookie helpers. Raw refresh tokens are not placed in JSON bodies."""

from starlette.responses import Response

from app.auth.service import IssuedSession
from app.core.config import get_settings
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, generate_csrf_token


def _cookie_flags() -> dict[str, object]:
    settings = get_settings()
    return {"secure": settings.use_secure_cookies, "samesite": settings.cookie_samesite}


def set_session_cookies(response: Response, session: IssuedSession) -> None:
    settings = get_settings()
    flags = _cookie_flags()
    response.set_cookie(
        ACCESS_COOKIE,
        session.access_token,
        httponly=True,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
        **flags,  # type: ignore[arg-type]
    )
    response.set_cookie(
        REFRESH_COOKIE,
        session.refresh_token,
        httponly=True,
        max_age=session.refresh_max_age,
        path="/api/v1/auth",
        **flags,  # type: ignore[arg-type]
    )


def clear_session_cookies(response: Response) -> None:
    flags = _cookie_flags()
    response.delete_cookie(ACCESS_COOKIE, path="/", httponly=True, **flags)  # type: ignore[arg-type]
    response.delete_cookie(
        REFRESH_COOKIE,
        path="/api/v1/auth",
        httponly=True,
        **flags,  # type: ignore[arg-type]
    )


def ensure_csrf_cookie(response: Response, existing: str | None = None) -> str:
    # Always mint a fresh token so the JSON body and Set-Cookie stay in sync
    # (avoids stale in-memory header tokens after logout / HMR / proxy changes).
    _ = existing
    token = generate_csrf_token()
    flags = _cookie_flags()
    response.set_cookie(
        CSRF_COOKIE,
        token,
        httponly=True,
        max_age=60 * 60 * 24 * 7,
        path="/",
        **flags,  # type: ignore[arg-type]
    )
    return token
