"""HTTP error contracts use real routes with isolated, deterministic service failures."""

import ast
import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated, get_args
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException, Query
from fastapi.testclient import TestClient

from app.api import deps
from app.api.routes import integrations, login, obligations
from app.core.api_error_codes import ErrorCode
from app.core.api_errors import ApplicationError, install_error_handlers
from app.domain.integrations import IntegrationConflictCode
from app.services import auth as auth_service
from app.use_cases import integrations as integration_use_cases
from app.use_cases import obligations as obligation_use_cases
from app.use_cases.exceptions import ObligationInvalidLifecycleError


@pytest.fixture
def api() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)
    for router in (login.router, obligations.router, integrations.router):
        app.include_router(router)
    app.dependency_overrides[deps.get_db] = lambda: Mock()
    app.dependency_overrides[deps.get_current_user] = lambda: SimpleNamespace(
        id=uuid.uuid4(), full_name="Test", email="test@example.com", is_superuser=True
    )
    ledger = SimpleNamespace(id=uuid.uuid4())
    app.dependency_overrides[deps.require_ledger_edit_access] = lambda: ledger
    app.dependency_overrides[deps.require_ledger_owner_access] = lambda: ledger
    return app


def test_auth_preserves_status_detail_and_adds_code(
    api: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth_service, "authenticate", Mock(return_value=None))
    response = TestClient(api).post(
        "/login/access-token", data={"username": "a@example.com", "password": "bad"}
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Incorrect email or password",
        "code": "auth_invalid_credentials",
        "params": {},
    }


def test_lifecycle_is_typed_independently_of_exception_message(
    api: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        obligation_use_cases,
        "mark_obligation_paid",
        Mock(
            side_effect=ObligationInvalidLifecycleError("arbitrary private diagnostic")
        ),
    )
    response = TestClient(api).post(
        f"/ledgers/{uuid.uuid4()}/obligations/ELEC-2026-10/mark-paid"
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": "Only ready obligations can be marked as paid",
        "code": "obligation_invalid_lifecycle",
        "params": {},
    }


def test_integration_conflict_retains_structured_legacy_detail(
    api: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    reason = next(iter(IntegrationConflictCode))
    monkeypatch.setattr(
        integration_use_cases,
        "update_integration",
        Mock(side_effect=integration_use_cases.IntegrationConflictError(reason)),
    )
    response = TestClient(api).patch(
        f"/ledgers/{uuid.uuid4()}/integrations/{uuid.uuid4()}",
        json={"expected_revision": 1, "name": "New"},
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": {"code": reason},
        "code": "integration_conflict",
        "params": {"reason": reason},
    }


def test_validation_keeps_pydantic_detail_and_constraints(api: FastAPI) -> None:
    @api.get("/validation")
    def validate(month: Annotated[int, Query(ge=1, le=12)]) -> None:
        assert 1 <= month <= 12

    response = TestClient(api).get("/validation?month=13")
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "request_validation_failed"
    assert body["params"] == {}
    assert body["detail"][0] == {
        "type": "less_than_equal",
        "loc": ["query", "month"],
        "msg": "Input should be less than or equal to 12",
        "input": "13",
        "ctx": {"le": 12},
    }


def test_fallback_auth_headers_and_unexpected_errors(
    api: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    @api.get("/unauthorized")
    def unauthorized() -> None:
        raise HTTPException(
            401, "Legacy diagnostic", headers={"WWW-Authenticate": "Bearer"}
        )

    @api.get("/unexpected")
    def unexpected() -> None:
        raise RuntimeError("operator-only diagnostic")

    client = TestClient(api, raise_server_exceptions=False)
    response = client.get("/unauthorized")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json() == {
        "detail": "Legacy diagnostic",
        "code": "auth_required",
        "params": {},
    }
    missing = client.get("/does-not-exist")
    assert missing.json()["code"] == "resource_not_found"
    failure = client.get("/unexpected")
    assert failure.status_code == 500
    assert failure.json() == {
        "detail": "Internal Server Error",
        "code": "internal_error",
        "params": {},
    }
    assert "operator-only diagnostic" in caplog.text
    assert "operator-only diagnostic" not in failure.text


def test_explicit_error_keeps_parameters_and_response_headers(api: FastAPI) -> None:
    @api.get("/quota")
    def quota() -> None:
        raise ApplicationError(
            409,
            "Original quota detail",
            code="demo_limit_reached",
            params={"limit": 3, "resource": "ledgers"},
            headers={"Retry-After": "60"},
        )

    response = TestClient(api).get("/quota")
    assert response.status_code == 409
    assert response.headers["Retry-After"] == "60"
    assert response.json() == {
        "detail": "Original quota detail",
        "code": "demo_limit_reached",
        "params": {"limit": 3, "resource": "ledgers"},
    }


def test_error_catalog_and_all_application_raises_are_explicit() -> None:
    root = Path(__file__).resolve().parents[3]
    known = set(get_args(ErrorCode))
    english = json.loads(
        (root / "frontend/src/i18n/locales/en/errors.json").read_text()
    )
    polish = json.loads((root / "frontend/src/i18n/locales/pl/errors.json").read_text())
    assert known <= english.keys() == polish.keys()
    for path in (root / "backend/app/api").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "HTTPException"
            ):
                code = next(
                    (
                        keyword.value
                        for keyword in node.keywords
                        if keyword.arg == "code"
                    ),
                    None,
                )
                assert isinstance(code, ast.Constant), (path, node.lineno)
                assert code.value in known, (path, node.lineno)


def test_demo_and_origin_guards_use_additive_contract(
    api: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import Depends

    from app.core.browser_auth import BrowserSessionSecurityMiddleware
    from app.core.config import settings

    monkeypatch.setattr(settings, "ENVIRONMENT", "demo")
    monkeypatch.setattr(settings, "DEMO_WRITES_ENABLED", False)

    @api.post("/write", dependencies=[Depends(deps.enforce_demo_write_policy)])
    def write() -> None:
        pass

    response = TestClient(api).post("/write")
    assert response.status_code == 403
    assert response.json() == {
        "detail": "Demo is temporarily read-only",
        "code": "demo_read_only",
        "params": {},
    }

    browser_api = FastAPI()
    browser_api.add_middleware(BrowserSessionSecurityMiddleware)
    blocked = TestClient(browser_api).post(
        "/write", headers={"origin": "https://untrusted.example"}
    )
    assert blocked.status_code == 403
    assert blocked.json() == {
        "detail": "Origin is not allowed",
        "code": "auth_origin_forbidden",
        "params": {},
    }
