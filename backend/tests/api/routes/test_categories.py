import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import LedgerAccessRole
from app.use_cases import categories as category_use_cases
from app.use_cases import ledgers as ledger_use_cases
from tests.utils.user import authentication_token_from_email, create_random_user
from tests.utils.utils import random_lower_string


def test_get_category_groups_returns_only_groups_for_that_ledger(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger_one = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_two = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    group_one = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger_one.id,
        name=f"group-{random_lower_string()}",
    )
    category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger_two.id,
        name=f"group-{random_lower_string()}",
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger_one.id}/category-groups",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["id"] == str(group_one.id)


def test_get_category_groups_returns_404_for_user_without_access(
    client: TestClient,
    db: Session,
) -> None:
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
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups",
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_post_category_group_creates_group_for_editor(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    editor = create_random_user(db)
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
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups",
        headers=editor_headers,
        json={"name": f"group-{random_lower_string()}", "description": "Ops"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ledger_id"] == str(ledger.id)
    assert payload["is_active"] is True


def test_post_category_group_rejects_viewer(client: TestClient, db: Session) -> None:
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

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups",
        headers=viewer_headers,
        json={"name": f"group-{random_lower_string()}"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_post_category_group_rejects_duplicate_name(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    group_name = f"group-{random_lower_string()}"
    category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=group_name
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups",
        headers=headers,
        json={"name": group_name},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Category group already exists"


def test_patch_category_group_updates_group_and_returns_404_when_missing(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )

    updated = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups/{category_group.id}",
        headers=headers,
        json={"name": "Updated group", "description": "Updated description"},
    )
    missing = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups/{uuid.uuid4()}",
        headers=headers,
        json={"name": "Missing group"},
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated group"
    assert updated.json()["description"] == "Updated description"
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Category group not found"


def test_patch_category_group_archive_succeeds_for_empty_group(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups/{category_group.id}/archive",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_active"] is False
    assert payload["archived_at"] is not None


def test_patch_category_group_archive_fails_when_active_child_categories_exist(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name=f"category-{random_lower_string()}",
        code="CHLD",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups/{category_group.id}/archive",
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Category group has active categories"


def test_patch_category_group_archive_returns_404_for_missing_group(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/category-groups/{uuid.uuid4()}/archive",
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Category group not found"


def test_get_categories_returns_only_categories_for_that_ledger(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger_one = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_two = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    group_one = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger_one.id,
        name=f"group-{random_lower_string()}",
    )
    group_two = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger_two.id,
        name=f"group-{random_lower_string()}",
    )
    category_one = category_use_cases.create_category(
        session=db,
        ledger_id=ledger_one.id,
        category_group_id=group_one.id,
        name=f"category-{random_lower_string()}",
        code="LONE",
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger_two.id,
        category_group_id=group_two.id,
        name=f"category-{random_lower_string()}",
        code="LTWO",
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger_one.id}/categories",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["id"] == str(category_one.id)
    assert payload["data"][0]["category_group_id"] == str(group_one.id)
    assert payload["data"][0]["has_data_schema"] is False
    assert payload["data"][0]["active_data_schema_version"] is None


def test_get_categories_returns_active_data_schema_metadata(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name=f"category-{random_lower_string()}",
        code="SCHM",
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={"type": "object"},
    )
    category_use_cases.set_category_data_schema(
        session=db,
        ledger_id=ledger.id,
        category_id=category.id,
        schema={"type": "object", "properties": {"note": {"type": "string"}}},
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=headers,
    )

    assert response.status_code == 200
    category_payload = response.json()["data"][0]
    assert category_payload["has_data_schema"] is True
    assert category_payload["active_data_schema_version"] == 2


def test_get_categories_supports_group_filter(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    group_one = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    group_two = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category_one = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group_one.id,
        name=f"category-{random_lower_string()}",
        code="GONE",
    )
    category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=group_two.id,
        name=f"category-{random_lower_string()}",
        code="GTWO",
    )

    response = client.get(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories?category_group_id={group_one.id}",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["id"] == str(category_one.id)


def test_get_categories_returns_404_for_user_without_access(
    client: TestClient,
    db: Session,
) -> None:
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
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_post_category_creates_category_under_correct_group(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    editor = create_random_user(db)
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
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=editor_headers,
        json={
            "category_group_id": str(category_group.id),
            "name": f"category-{random_lower_string()}",
            "description": "Housing",
            "code": "HOUS",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ledger_id"] == str(ledger.id)
    assert payload["category_group_id"] == str(category_group.id)
    assert payload["is_active"] is True


def test_post_category_rejects_cross_ledger_group_reference(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger_one = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    ledger_two = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger_two.id,
        name=f"group-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger_one.id}/categories",
        headers=headers,
        json={
            "category_group_id": str(category_group.id),
            "name": f"category-{random_lower_string()}",
            "code": "CROS",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Category group not found"


def test_post_category_rejects_archived_group(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category_use_cases.archive_category_group(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=headers,
        json={
            "category_group_id": str(category_group.id),
            "name": f"category-{random_lower_string()}",
            "code": "ARCH",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Category group is archived"


def test_post_category_rejects_viewer(client: TestClient, db: Session) -> None:
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
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )

    response = client.post(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories",
        headers=viewer_headers,
        json={
            "category_group_id": str(category_group.id),
            "name": f"category-{random_lower_string()}",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_patch_category_archive_archives_category_for_authorized_editor(
    client: TestClient,
    db: Session,
) -> None:
    owner = create_random_user(db)
    editor = create_random_user(db)
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
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name=f"category-{random_lower_string()}",
        code="EDIT",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/archive",
        headers=editor_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_active"] is False
    assert payload["archived_at"] is not None


def test_patch_category_archive_returns_404_for_non_member_access(
    client: TestClient,
    db: Session,
) -> None:
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
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name=f"category-{random_lower_string()}",
        code="OUTS",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/archive",
        headers=outsider_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Ledger not found"


def test_patch_category_rejects_code_change(client: TestClient, db: Session) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db,
        owner_user_id=owner.id,
        name=f"ledger-{random_lower_string()}",
    )
    category_group = category_use_cases.create_category_group(
        session=db,
        ledger_id=ledger.id,
        name=f"group-{random_lower_string()}",
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name=f"category-{random_lower_string()}",
        code="IMMU",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}",
        headers=headers,
        json={
            "name": category.name,
            "data_source_policy": category.data_source_policy.value,
            "currency": category.currency,
            "code": "CHNG",
        },
    )

    assert response.status_code == 422


def test_patch_category_updates_category_and_returns_404_when_missing(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name=f"group-{random_lower_string()}"
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Electricity",
        code="ELEC",
    )
    payload = {
        "name": "Updated electricity",
        "description": "Monthly bill",
        "data_source_policy": "hybrid",
        "currency": "PLN",
        "first_due_date": "2026-01-15",
    }

    updated = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}",
        headers=headers,
        json=payload,
    )
    missing = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{uuid.uuid4()}",
        headers=headers,
        json=payload,
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated electricity"
    assert updated.json()["first_due_date"] == "2026-01-15"
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Category not found"


def test_patch_category_moves_category_to_another_active_group(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    source_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name="Housing"
    )
    target_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name="Utilities"
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=source_group.id,
        name="Rent",
        code="RENT",
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}",
        headers=headers,
        json={
            "category_group_id": str(target_group.id),
            "name": category.name,
            "data_source_policy": "hybrid",
            "currency": "PLN",
        },
    )

    assert response.status_code == 200
    assert response.json()["category_group_id"] == str(target_group.id)


def test_patch_category_restore_restores_archived_category(
    client: TestClient, db: Session
) -> None:
    owner = create_random_user(db)
    headers = authentication_token_from_email(client=client, email=owner.email, db=db)
    ledger = ledger_use_cases.create_ledger(
        session=db, owner_user_id=owner.id, name=f"ledger-{random_lower_string()}"
    )
    category_group = category_use_cases.create_category_group(
        session=db, ledger_id=ledger.id, name="Housing"
    )
    category = category_use_cases.create_category(
        session=db,
        ledger_id=ledger.id,
        category_group_id=category_group.id,
        name="Rent",
        code="RENT",
    )
    category_use_cases.archive_category(
        session=db, ledger_id=ledger.id, category_id=category.id
    )

    response = client.patch(
        f"{settings.API_V1_STR}/ledgers/{ledger.id}/categories/{category.id}/restore",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert response.json()["archived_at"] is None
