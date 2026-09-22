from unittest.mock import MagicMock

import pytest

from app import initial_data


def test_init_initializes_database_with_open_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    monkeypatch.setattr(initial_data, "Session", lambda _engine: session_context)
    init_db = MagicMock()
    monkeypatch.setattr(initial_data, "init_db", init_db)

    initial_data.init()

    init_db.assert_called_once_with(session)
    session_context.__exit__.assert_called_once_with(None, None, None)
