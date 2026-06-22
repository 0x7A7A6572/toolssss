from unittest.mock import patch

from app.domains.windows.border_manager import BorderTarget, TopmostBorderManager
from app.domains.windows.service import sync_topmost_borders


def test_topmost_border_sync_returns_ok(client) -> None:
    payload = {
        "enabled": True,
        "color": "#3b82f6",
        "width": 3,
        "hwnds": ["1001", "1002"],
    }
    with patch("app.domains.windows.router.sync_topmost_borders", return_value=2) as mocked:
        res = client.post("/api/windows/topmost-borders/sync", json=payload)

    assert res.status_code == 200
    assert res.json() == {"ok": True, "count": 2}
    mocked.assert_called_once_with(
        enabled=True,
        color="#3b82f6",
        width=3,
        hwnds=["1001", "1002"],
    )


def test_topmost_border_clear_returns_ok(client) -> None:
    with patch("app.domains.windows.router.clear_topmost_borders", return_value=0) as mocked:
        res = client.post("/api/windows/topmost-borders/clear", json={})

    assert res.status_code == 200
    assert res.json() == {"ok": True, "count": 0}
    mocked.assert_called_once_with()


def test_topmost_border_sync_rejects_bad_color(client) -> None:
    payload = {
        "enabled": True,
        "color": "blue",
        "width": 3,
        "hwnds": ["1001"],
    }

    res = client.post("/api/windows/topmost-borders/sync", json=payload)

    assert res.status_code == 422


def test_service_sync_filters_blank_hwnds() -> None:
    with patch("app.domains.windows.service._BORDER_MANAGER.sync", return_value=2) as mocked:
        count = sync_topmost_borders(
            enabled=True,
            color="#3b82f6",
            width=3,
            hwnds=["1001", "", "1001", "  ", "1002"],
        )

    assert count == 2
    mocked.assert_called_once_with(
        enabled=True,
        color="#3b82f6",
        width=3,
        hwnds=["1001", "1002"],
    )


def test_manager_sync_removes_missing_hwnds() -> None:
    manager = TopmostBorderManager(start_runtime=False)
    manager._targets = {
        "1001": BorderTarget(hwnd="1001", root_hwnd=1001),
        "1002": BorderTarget(hwnd="1002", root_hwnd=1002),
    }

    manager.sync(enabled=True, color="#3b82f6", width=3, hwnds=["1002", "1003"])

    assert sorted(manager._targets.keys()) == ["1002", "1003"]
