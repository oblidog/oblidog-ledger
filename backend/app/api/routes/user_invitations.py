import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.core.config import settings
from app.models import UserInvitation
from app.schemas import (
    Message,
    UserInvitationAccept,
    UserInvitationCreate,
    UserInvitationInspect,
    UserInvitationPublic,
    UserInvitationsPublic,
    UserPublic,
)
from app.services import user_invitations as invitation_service
from app.utils import generate_user_invitation_email, send_email

admin_router = APIRouter(
    prefix="/users/invitations",
    tags=["user invitations"],
    dependencies=[Depends(get_current_active_superuser)],
)
public_router = APIRouter(prefix="/invitations", tags=["user invitations"])


def _public(invitation: UserInvitation) -> UserInvitationPublic:
    return UserInvitationPublic(
        id=invitation.id,
        email=invitation.email,
        full_name=invitation.full_name,
        is_superuser=invitation.is_superuser,
        status=invitation_service.invitation_status(invitation),
        expires_at=invitation.expires_at,
        accepted_at=invitation.accepted_at,
        revoked_at=invitation.revoked_at,
        created_at=invitation.created_at,
        created_by_user_id=invitation.created_by_user_id,
    )


def _send_invitation(email: str, token: str) -> None:
    if not settings.emails_enabled:
        return
    email_data = generate_user_invitation_email(
        email_to=email,
        token=token,
        valid_hours=settings.USER_INVITATION_EXPIRE_HOURS,
    )
    send_email(
        email_to=email,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, invitation_service.InvitationNotFoundError):
        raise HTTPException(status_code=404, detail="Invitation not found")
    if isinstance(exc, invitation_service.InvitationExpiredError):
        raise HTTPException(status_code=410, detail="Invitation has expired")
    if isinstance(exc, invitation_service.InvitationRevokedError):
        raise HTTPException(status_code=410, detail="Invitation has been revoked")
    if isinstance(exc, invitation_service.InvitationAcceptedError):
        raise HTTPException(
            status_code=409, detail="Invitation has already been accepted"
        )
    if isinstance(exc, invitation_service.InvitationAlreadyExistsError):
        raise HTTPException(
            status_code=409, detail="An active invitation for this email already exists"
        )
    if isinstance(exc, invitation_service.InvitationUserAlreadyExistsError):
        raise HTTPException(
            status_code=409, detail="A user with this email already exists"
        )
    raise exc


@admin_router.post(
    "", response_model=UserInvitationPublic, status_code=status.HTTP_201_CREATED
)
def create_invitation(
    *, session: SessionDep, current_user: CurrentUser, body: UserInvitationCreate
) -> UserInvitationPublic:
    try:
        delivery = invitation_service.create_invitation(
            session=session, invitation_in=body, created_by=current_user
        )
    except Exception as exc:
        _raise_http_error(exc)
    _send_invitation(delivery.invitation.email, delivery.token)
    return _public(delivery.invitation)


@admin_router.get("", response_model=UserInvitationsPublic)
def list_invitations(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> UserInvitationsPublic:
    invitations = invitation_service.list_invitations(
        session=session, skip=skip, limit=limit
    )
    return UserInvitationsPublic(
        data=[_public(invitation) for invitation in invitations],
        count=len(invitations),
    )


@admin_router.post("/{invitation_id}/resend", response_model=UserInvitationPublic)
def resend_invitation(
    invitation_id: uuid.UUID, session: SessionDep
) -> UserInvitationPublic:
    try:
        delivery = invitation_service.resend_invitation(
            session=session, invitation_id=invitation_id
        )
    except Exception as exc:
        _raise_http_error(exc)
    _send_invitation(delivery.invitation.email, delivery.token)
    return _public(delivery.invitation)


@admin_router.delete("/{invitation_id}", response_model=Message)
def revoke_invitation(invitation_id: uuid.UUID, session: SessionDep) -> Message:
    try:
        invitation_service.revoke_invitation(
            session=session, invitation_id=invitation_id
        )
    except Exception as exc:
        _raise_http_error(exc)
    return Message(message="Invitation revoked")


@public_router.get("/{token}", response_model=UserInvitationInspect)
def inspect_invitation(token: str, session: SessionDep) -> UserInvitationInspect:
    try:
        invitation = invitation_service.inspect_invitation(session=session, token=token)
    except Exception as exc:
        _raise_http_error(exc)
    return UserInvitationInspect(
        email=invitation.email, expires_at=invitation.expires_at
    )


@public_router.post("/{token}/accept", response_model=UserPublic)
def accept_invitation(
    token: str, body: UserInvitationAccept, session: SessionDep
) -> UserPublic:
    try:
        user = invitation_service.accept_invitation(
            session=session, token=token, new_password=body.new_password
        )
    except Exception as exc:
        _raise_http_error(exc)
    return UserPublic.model_validate(user)
