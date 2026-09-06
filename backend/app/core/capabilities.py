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
