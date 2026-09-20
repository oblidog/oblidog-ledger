from typing import Annotated

from pydantic import BaseModel, Field


class Message(BaseModel):
    message: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str | None = None
    # Tokens issued before session versioning was introduced are version 1.
    session_version: int = 1


PasswordStr = Annotated[str, Field(min_length=8, max_length=128)]


class NewPassword(BaseModel):
    token: str
    new_password: PasswordStr
