import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
)
from app.schemas import (
    Message,
    UpdatePassword,
    UserPublic,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)
from app.schemas.users import UserReportPreferences, UserReportPreferencesUpdate
from app.services import users as user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/",
    dependencies=[Depends(get_current_active_superuser)],
    response_model=UsersPublic,
)
def read_users(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    """
    Retrieve users.
    """
    users = user_service.list_users(session=session, skip=skip, limit=limit)
    return UsersPublic(
        data=[UserPublic.model_validate(user) for user in users],
        count=len(users),
    )


@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    """
    Update own user.
    """
    try:
        return user_service.update_user_me(
            session=session, current_user=current_user, user_in=user_in
        )
    except user_service.UserEmailAlreadyExistsError as caught_error:
        raise HTTPException(
            status_code=409, detail="User with this email already exists"
        ) from caught_error


@router.get("/me/report-preferences", response_model=UserReportPreferences)
def read_report_preferences(current_user: CurrentUser) -> Any:
    """Read own scheduled report preferences."""
    return current_user


@router.patch("/me/report-preferences", response_model=UserReportPreferences)
def update_report_preferences(
    *,
    session: SessionDep,
    preferences: UserReportPreferencesUpdate,
    current_user: CurrentUser,
) -> Any:
    """Update own report toggles without changing the application schedule."""
    return user_service.update_report_preferences(
        session=session, current_user=current_user, preferences=preferences
    )


@router.patch("/me/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Any:
    """
    Update own password.
    """
    try:
        user_service.update_password(
            session=session,
            current_user=current_user,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    except user_service.IncorrectPasswordError as caught_error:
        raise HTTPException(
            status_code=400, detail="Incorrect password"
        ) from caught_error
    except user_service.SamePasswordError as caught_error:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        ) from caught_error
    return Message(message="Password updated successfully")


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return current_user


@router.delete("/me", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Delete own user.
    """
    try:
        user_service.delete_user_me(session=session, current_user=current_user)
    except user_service.SelfDeleteForbiddenError as caught_error:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        ) from caught_error
    return Message(message="User deleted successfully")


@router.post("/signup", include_in_schema=False)
def signup_disabled() -> None:
    raise HTTPException(status_code=404, detail="Not found")


@router.get("/{user_id}", response_model=UserPublic)
def read_user_by_id(
    user_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    """
    Get a specific user by id.
    """
    try:
        return user_service.get_user_for_view(
            session=session, current_user=current_user, user_id=user_id
        )
    except user_service.InsufficientPrivilegesError as caught_error:
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        ) from caught_error
    except user_service.UserNotFoundError as caught_error:
        raise HTTPException(status_code=404, detail="User not found") from caught_error


@router.patch(
    "/{user_id}",
    dependencies=[Depends(get_current_active_superuser)],
    response_model=UserPublic,
)
def update_user(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    user_in: UserUpdate,
) -> Any:
    """
    Update a user.
    """

    try:
        return user_service.update_user_by_id(
            session=session,
            user_id=user_id,
            user_in=user_in,
        )
    except user_service.UserNotFoundError as caught_error:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        ) from caught_error
    except user_service.UserEmailAlreadyExistsError as caught_error:
        raise HTTPException(
            status_code=409, detail="User with this email already exists"
        ) from caught_error


@router.delete("/{user_id}", dependencies=[Depends(get_current_active_superuser)])
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    """
    Delete a user.
    """
    try:
        user_service.delete_user_by_id(
            session=session, current_user=current_user, user_id=user_id
        )
    except user_service.UserNotFoundError as caught_error:
        raise HTTPException(status_code=404, detail="User not found") from caught_error
    except user_service.SelfDeleteForbiddenError as caught_error:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        ) from caught_error
    return Message(message="User deleted successfully")
