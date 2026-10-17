from enum import StrEnum

from app.core.config import settings


class Capability(StrEnum):
    API_KEYS = "api_keys"
    INTEGRATIONS = "integrations"
    ACCOUNT_SECURITY = "account_security"
    EMAIL = "email"
    LEDGER_SETTINGS = "ledger_settings"


DEMO_DISABLED_CAPABILITIES = frozenset(
    {
        Capability.API_KEYS,
        Capability.INTEGRATIONS,
        Capability.ACCOUNT_SECURITY,
        Capability.EMAIL,
        Capability.LEDGER_SETTINGS,
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

    parts = normalized_path.split("/")
    if "ledgers" in parts:
        ledger_path = parts[parts.index("ledgers") + 1 :]
        if (
            normalized_method in {"GET", "HEAD"}
            and len(ledger_path) in {2, 3, 4}
            and ledger_path[1] == "integrations"
            and (len(ledger_path) < 4 or ledger_path[3] == "runs")
        ):
            # Management reads still require access to this specific ledger.
            # Runner endpoints and all credential/configuration writes stay blocked.
            return None
        if (len(ledger_path) == 1 and normalized_method == "PATCH") or (
            len(ledger_path) == 2
            and ledger_path[1] in {"categories", "obligations"}
            and normalized_method == "DELETE"
        ):
            return Capability.LEDGER_SETTINGS

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

    if "/invitations" in normalized_path:
        return Capability.ACCOUNT_SECURITY

    if "/users" in normalized_path and normalized_method not in {"GET", "HEAD"}:
        # Normal token login lives outside /users and remains available in demo.
        return Capability.ACCOUNT_SECURITY

    if "/members" in normalized_path and normalized_method not in {"GET", "HEAD"}:
        return Capability.ACCOUNT_SECURITY

    return None
