from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum


class ObligationActionType(StrEnum):
    CREATED = "created"
    VALUES_UPDATED = "values_updated"
    COMPONENTS_CHANGED = "components_changed"
    MARKED_READY = "marked_ready"
    MARKED_PAID = "marked_paid"
    CANCELED = "canceled"
    REOPENED = "reopened"
    MARKED_ERROR = "marked_error"


class ObligationActionActorType(StrEnum):
    USER = "user"
    INTEGRATION = "integration"
    SYSTEM = "system"


@dataclass(frozen=True, slots=True)
class ObligationActionActor:
    actor_type: ObligationActionActorType
    actor_id: uuid.UUID | None
    display_name: str
    integration_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None

    @classmethod
    def user(cls, *, user_id: uuid.UUID, display_name: str) -> ObligationActionActor:
        return cls(
            actor_type=ObligationActionActorType.USER,
            actor_id=user_id,
            display_name=display_name,
        )

    @classmethod
    def integration(
        cls,
        *,
        integration_id: uuid.UUID,
        display_name: str,
        run_id: uuid.UUID | None,
    ) -> ObligationActionActor:
        return cls(
            actor_type=ObligationActionActorType.INTEGRATION,
            actor_id=integration_id,
            display_name=display_name,
            integration_id=integration_id,
            run_id=run_id,
        )

    @classmethod
    def system(cls, display_name: str = "System") -> ObligationActionActor:
        return cls(
            actor_type=ObligationActionActorType.SYSTEM,
            actor_id=None,
            display_name=display_name,
        )


SYSTEM_ACTION_ACTOR = ObligationActionActor.system()
