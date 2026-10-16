import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import BillingPeriod, LedgerAccessRole
from app.models import LedgerMembership, Obligation
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from app.use_cases import obligations as obligation_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string


def test_get_ledgers_returns_owned_and_shared_ledgers(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    shared_user = create_random_user(db)
    shared_headers = authentication_token_from_email(
        client=client, email=shared_user.email, db=db
    )
    owned_ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=shared_user.id,
        name=f"owned-{random_lower_string()}",
    )
    shared_ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"shared-{random_lower_string()}",
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=shared_ledger.id,
        target_user_id=shared_user.id,
        role=LedgerAccessRole.VIEWER,
    )

    response = client.get(f"{settings.API_V1_STR}/ledgers/", headers=shared_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert {item["id"] for item in payload["data"]} == {
        str(owned_ledger.id),
        str(shared_ledger.id),
    }


def test_post_ledgers_creates_ledger_and_owner_membership(
    client: TestClient,
    db: Session,
) -> None:
    user = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=user.email, db=db)

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/",
        headers=headers,
        json={"name": f"ledger-{random_lower_string()}", "description": "Primary"},
    )

    assert response.status_code == 200
    payload = response.json()
    membership = db.get(
        LedgerMembership,
        {"ledger_id": uuid.UUID(payload["id"]), "user_id": user.id},
    )
    assert payload["owner_user_id"] == str(user.id)
    assert membership is not None
    assert membership.role == LedgerAccessRole.OWNER


def test_patch_ledger_updates_name_and_description(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name="Before",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}",
        headers=owner_headers,
        json={"name": "After", "description": "Updated"},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "After"
    assert response.json()["description"] == "Updated"


def test_delete_ledger_categories_allows_owner(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name="Ledger",
    )

    response = client.delete(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=owner_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "All ledger categories deleted"}


def test_delete_ledger_obligations_allows_owner(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name="Ledger"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name="Group"
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    obligation_use_cases.create_manual_obligation(
        session=db,
        ledger_id=ledger.id,
        category_code="ELEC",
        period=BillingPeriod(2026, 3),
    )

    response = client.delete(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/obligations",
        headers=owner_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "All ledger obligations deleted"}
    assert db.query(Obligation).filter(Obligation.ledger_id == ledger.id).count() == 0


def test_get_ledger_returns_404_for_non_member(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    outsider = create_random_user(db)
    outsider_headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}",
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_get_ledger_members_returns_members_for_authorized_user(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    viewer = create_random_user(db)
    viewer_headers = authentication_token_from_email(
        client=client, email=viewer.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=viewer.id,
        role=LedgerAccessRole.VIEWER,
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=viewer_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    roles = {item["user_id"]: item["role"] for item in payload["data"]}
    assert roles[str(owner.id)] == "owner"
    assert roles[str(viewer.id)] == "viewer"
    members_by_id = {item["user_id"]: item for item in payload["data"]}
    assert members_by_id[str(owner.id)]["email"] == owner.email
    assert members_by_id[str(viewer.id)]["email"] == viewer.email


def test_post_ledger_members_allows_owner_to_share(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    target = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=owner_headers,
        json={"user_id": str(target.id), "role": "viewer"},
    )

    assert response.status_code == 200
    payload = response.json()
    membership = db.get(
        LedgerMembership,
        {"ledger_id": ledger.id, "user_id": target.id},
    )
    assert payload["user_id"] == str(target.id)
    assert payload["role"] == "viewer"
    assert membership is not None


def test_post_ledger_members_allows_owner_to_share_by_email(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    target = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=owner_headers,
        json={"email": target.email, "role": "editor"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == str(target.id)
    assert response.json()["role"] == "editor"


def test_post_ledger_members_returns_404_for_unknown_email(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=owner_headers,
        json={"email": "missing@example.com", "role": "viewer"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def test_patch_ledger_member_updates_role(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    target = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=target.id,
        role=LedgerAccessRole.VIEWER,
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members/{target.id}",
        headers=owner_headers,
        json={"role": "editor"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "editor"


def test_delete_ledger_member_removes_access(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    target = create_random_user(db)
    owner_headers = authentication_token_from_email(
        client=client, email=owner.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=target.id,
        role=LedgerAccessRole.VIEWER,
    )

    response = client.delete(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members/{target.id}",
        headers=owner_headers,
    )

    assert response.status_code == 200
    assert (
        db.get(
            LedgerMembership,
            {"ledger_id": ledger.id, "user_id": target.id},
        )
        is None
    )


def test_post_ledger_members_rejects_non_owner(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    editor = create_random_user(db)
    target = create_random_user(db)
    editor_headers = authentication_token_from_email(
        client=client, email=editor.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_use_cases.share_ledger(
        session=db,
        ledger_id=ledger.id,
        target_user_id=editor.id,
        role=LedgerAccessRole.EDITOR,
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=editor_headers,
        json={"user_id": str(target.id), "role": "viewer"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_post_ledger_members_returns_404_for_non_member_access(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    outsider = create_random_user(db)
    target = create_random_user(db)
    outsider_headers = authentication_token_from_email(
        client=client, email=outsider.email, db=db
    )
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/members",
        headers=outsider_headers,
        json={"user_id": str(target.id), "role": "viewer"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"
