import hashlib
import hmac
import secrets

from app.core.config import settings

API_KEY_PREFIX = "fdg_live_"
API_KEY_SAFE_PREFIX_LENGTH = 16
API_KEY_PBKDF2_ITERATIONS = 600_000
API_KEY_SALT_LENGTH = 16


def generate_api_key() -> str:
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def _api_key_salt(raw_key: str) -> bytes:
    """Derive a deterministic per-key salt from the key prefix and server secret."""
    prefix = key_prefix(raw_key)
    return hmac.new(
        str(settings.SECRET_KEY).encode(), prefix.encode(), hashlib.sha256
    ).digest()[:API_KEY_SALT_LENGTH]


def hash_api_key(raw_key: str) -> str:
    """Return a deterministic, computationally expensive digest for key lookup."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        raw_key.encode(),
        _api_key_salt(raw_key),
        API_KEY_PBKDF2_ITERATIONS,
    ).hex()


def key_prefix(raw_key: str) -> str:
    return raw_key[:API_KEY_SAFE_PREFIX_LENGTH]


def verify_api_key(raw_key: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_api_key(raw_key), stored_hash)
