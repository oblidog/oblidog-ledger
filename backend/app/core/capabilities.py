from enum import StrEnum

from app.core.config import settings


class Capability(StrEnum):
    API_KEYS = "api_keys"
    INTEGRATIONS = "integrations"
    ACCOUNT_SECURITY = "account_security"
    EMAIL = "email"


DEMO_DISABLED_CAPABILITIES = frozenset(
    {
        Capability.API_KEYS,
        Capability.INTEGRATIONS,
        Capability.ACCOUNT_SECURITY,
        Capability.EMAIL,
    }
)


class CapabilityDisabledError(RuntimeError):
    def __init__(self, capability: Capability) -> None:
        self.capability = capability
        super().__init__(f"{capability.value} is disabled in demo environment")


def is_capability_enabled(capability: Capability) -> bool:
    return not (
        settings.ENVIRONMENT == "demo" and capability in DEMO_DISABLED_CAPABILITIES
    )


def ensure_capability(capability: Capability) -> None:
    if not is_capability_enabled(capability):
        raise CapabilityDisabledError(capability)


def capability_for_request(*, method: str, path: str) -> Capability | None:
    """Return the restricted capability exercised by an API request, if any."""

    normalized_path = path.rstrip("/")
    normalized_method = method.upper()

    if "/api-keys" in normalized_path:
        return Capability.API_KEYS

    if "/integration" in normalized_path or "/legacy-import" in normalized_path:
        return Capability.INTEGRATIONS

    if "/system-runs" in normalized_path and normalized_method not in {"GET", "HEAD"}:
        return Capability.INTEGRATIONS

    if normalized_path.endswith("/utils/test-email"):
        return Capability.EMAIL

    if "/password-recovery" in normalized_path or normalized_path.endswith(
        "/reset-password"
    ):
        return Capability.ACCOUNT_SECURITY

    if "/users" in normalized_path and normalized_method not in {"GET", "HEAD"}:
        # Normal token login lives outside /users and remains available in demo.
        return Capability.ACCOUNT_SECURITY

    if "/members" in normalized_path and normalized_method not in {"GET", "HEAD"}:
        return Capability.ACCOUNT_SECURITY

    return None
