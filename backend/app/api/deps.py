import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
    OAuth2PasswordBearer,
)
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core import security
from app.core.capabilities import (
    Capability,
    CapabilityDisabledError,
    capability_for_request,
    ensure_capability,
)
from app.core.config import settings
from app.core.db import SessionLocal
from app.domain import LedgerAccessRole
from app.models import ApiKey, Ledger, LedgerMembership, User
from app.schemas import TokenPayload
from app.services import api_keys as api_key_service
from app.services import users as user_service

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]
integration_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="IntegrationApiKey",
    description="A ledger-scoped API key, for example fdg_live_…",
)
IntegrationTokenDep = Annotated[
    HTTPAuthorizationCredentials | None, Depends(integration_bearer)
]


@dataclass(frozen=True, slots=True)
class ApiContext:
    session: Session
    ledger: Ledger
    api_key: ApiKey
    scopes: frozenset[str]


def require_capability(capability: Capability) -> Callable[[], None]:
    def dependency() -> None:
        try:
            ensure_capability(capability)
        except CapabilityDisabledError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    return dependency


def enforce_demo_request_capabilities(request: Request) -> None:
    capability = capability_for_request(method=request.method, path=request.url.path)
    if capability is None:
        return
    try:
        ensure_capability(capability)
    except CapabilityDisabledError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def get_current_user(session: SessionDep, token: TokenDep) -> User:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
        if token_data.sub is None:
            raise ValueError
        user_id = uuid.UUID(token_data.sub)
    except (InvalidTokenError, ValidationError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    user = user_service.get_user_by_id(session=session, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_api_context(session: SessionDep, token: IntegrationTokenDep) -> ApiContext:
    if token is None or token.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid API key")

    key_hash = api_key_service.hash_api_key(token.credentials)
    api_key = session.scalar(select(ApiKey).where(ApiKey.key_hash == key_hash))
    if api_key is None or not api_key_service.verify_api_key(
        token.credentials, api_key.key_hash
    ):
        raise HTTPException(status_code=401, detail="Invalid API key")

    now = datetime.now(UTC)
    if api_key.revoked_at is not None or (
        api_key.expires_at is not None and api_key.expires_at <= now
    ):
        raise HTTPException(status_code=401, detail="API key is inactive")

    ledger = session.get(Ledger, api_key.ledger_id)
    if ledger is None or not ledger.is_active:
        raise HTTPException(status_code=401, detail="API key is inactive")

    api_key.last_used_at = now
    session.commit()
    return ApiContext(
        session=session,
        ledger=ledger,
        api_key=api_key,
        scopes=frozenset(api_key.scopes),
    )


ApiContextDep = Annotated[ApiContext, Depends(get_api_context)]


def require_scope(scope: str) -> Callable[[ApiContext], ApiContext]:
    def dependency(context: ApiContextDep) -> ApiContext:
        if scope not in context.scopes:
            raise HTTPException(
                status_code=403, detail=f"Missing required scope: {scope}"
            )
        return context

    return dependency


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def require_ledger_view_access(
    ledger_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Ledger:
    ledger = session.scalar(
        select(Ledger).where(
            Ledger.id == ledger_id,
            or_(
                Ledger.owner_user_id == current_user.id,
                Ledger.memberships.any(LedgerMembership.user_id == current_user.id),
            ),
        )
    )
    if ledger is None:
        raise HTTPException(status_code=404, detail="Ledger not found")
    return ledger


def require_ledger_owner_access(
    ledger_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Ledger:
    ledger = session.scalar(
        select(Ledger).where(
            Ledger.id == ledger_id,
            Ledger.owner_user_id == current_user.id,
        )
    )
    if ledger is None:
        raise HTTPException(status_code=404, detail="Ledger not found")
    return ledger


def require_ledger_edit_access(
    ledger_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Ledger:
    ledger = session.scalar(
        select(Ledger).where(
            Ledger.id == ledger_id,
            or_(
                Ledger.owner_user_id == current_user.id,
                Ledger.memberships.any(
                    and_(
                        LedgerMembership.user_id == current_user.id,
                        LedgerMembership.role.in_(
                            [LedgerAccessRole.OWNER, LedgerAccessRole.EDITOR]
                        ),
                    )
                ),
            ),
        )
    )
    if ledger is None:
        raise HTTPException(status_code=404, detail="Ledger not found")
    return ledger
