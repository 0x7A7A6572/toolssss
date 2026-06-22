from unittest.mock import patch


def test_window_from_point_returns_window_info(client) -> None:
    with patch(
        "app.domains.windows.router.get_window_from_point",
        return_value={"hwnd": "12345", "title": "Test Window"},
    ) as mocked:
        res = client.post("/api/windows/from-point", json={"x": 120, "y": 240, "nodePid": 9527})

    assert res.status_code == 200
    assert res.json() == {"hwnd": "12345", "title": "Test Window"}
    mocked.assert_called_once_with(120, 240, 9527)


def test_window_from_point_returns_null_when_no_target(client) -> None:
    with patch("app.domains.windows.router.get_window_from_point", return_value=None) as mocked:
        res = client.post("/api/windows/from-point", json={"x": 1, "y": 2, "nodePid": 0})

    assert res.status_code == 200
    assert res.json() is None
    mocked.assert_called_once_with(1, 2, 0)


def test_window_topmost_returns_ok_flag(client) -> None:
    with patch("app.domains.windows.router.set_window_topmost", return_value=True) as mocked:
        res = client.post("/api/windows/topmost", json={"hwnd": "4321", "topmost": True})

    assert res.status_code == 200
    assert res.json() == {"ok": True}
    mocked.assert_called_once_with("4321", True)


def test_window_topmost_rejects_empty_hwnd(client) -> None:
    res = client.post("/api/windows/topmost", json={"hwnd": "", "topmost": False})

    assert res.status_code == 422


def test_window_root_returns_handle(client) -> None:
    with patch(
        "app.domains.windows.router.get_window_root",
        return_value={"hwnd": "2468"},
    ) as mocked:
        res = client.post("/api/windows/root", json={"hwnd": "4321"})

    assert res.status_code == 200
    assert res.json() == {"hwnd": "2468"}
    mocked.assert_called_once_with("4321")


def test_window_foreground_returns_window_info(client) -> None:
    with patch(
        "app.domains.windows.router.get_foreground_window",
        return_value={"hwnd": "67890", "title": "Foreground"},
    ) as mocked:
        res = client.post("/api/windows/foreground", json={"nodePid": 9527})

    assert res.status_code == 200
    assert res.json() == {"hwnd": "67890", "title": "Foreground"}
    mocked.assert_called_once_with(9527)


def test_window_rect_returns_rect(client) -> None:
    with patch(
        "app.domains.windows.router.get_window_rect",
        return_value={"left": 1, "top": 2, "right": 101, "bottom": 202},
    ) as mocked:
        res = client.post("/api/windows/rect", json={"hwnd": "4321"})

    assert res.status_code == 200
    assert res.json() == {"left": 1, "top": 2, "right": 101, "bottom": 202}
    mocked.assert_called_once_with("4321")


def test_window_rect_rejects_empty_hwnd(client) -> None:
    res = client.post("/api/windows/rect", json={"hwnd": ""})

    assert res.status_code == 422


def test_window_raise_returns_ok_flag(client) -> None:
    with patch("app.domains.windows.router.raise_window", return_value=True) as mocked:
        res = client.post("/api/windows/raise", json={"hwnd": "4321"})

    assert res.status_code == 200
    assert res.json() == {"ok": True}
    mocked.assert_called_once_with("4321")


def test_window_activate_returns_ok_flag(client) -> None:
    with patch("app.domains.windows.router.activate_window", return_value=True) as mocked:
        res = client.post("/api/windows/activate", json={"hwnd": "4321"})

    assert res.status_code == 200
    assert res.json() == {"ok": True}
    mocked.assert_called_once_with("4321")


def test_window_find_returns_list(client) -> None:
    expected = [
        {"hwnd": "100", "title": "TestApp"},
        {"hwnd": "200", "title": "TestApp - Editor"},
    ]
    with patch(
        "app.domains.windows.router.find_windows_by_title",
        return_value=expected,
    ) as mocked:
        res = client.post(
            "/api/windows/find",
            json={"title": "TestApp", "match": "contains", "limit": 10},
        )

    assert res.status_code == 200
    assert res.json() == expected
    mocked.assert_called_once_with(title="TestApp", match="contains", limit=10)


def test_window_hide_edge_returns_result(client) -> None:
    expected = {
        "ok": True,
        "hwnd": "4321",
        "rect": {"left": 100, "top": 200, "right": 500, "bottom": 600},
        "new_pos": {"x": 50, "y": 200},
    }
    with patch(
        "app.domains.windows.router.hide_window_to_edge",
        return_value=expected,
    ) as mocked:
        res = client.post(
            "/api/windows/hide-edge",
            json={"hwnd": "4321", "edge": "left", "peek_px": 50, "animate": False},
        )

    assert res.status_code == 200
    assert res.json() == expected
    mocked.assert_called_once_with(
        hwnd="4321", edge="left", peek_px=50, animate=False, duration_ms=180
    )


def test_window_restore_returns_ok(client) -> None:
    with patch(
        "app.domains.windows.router.restore_window",
        return_value={"ok": True, "hwnd": "4321"},
    ) as mocked:
        res = client.post(
            "/api/windows/restore",
            json={
                "hwnd": "4321",
                "rect": {"left": 100, "top": 200, "right": 500, "bottom": 600},
                "animate": False,
            },
        )

    assert res.status_code == 200
    assert res.json() == {"ok": True, "hwnd": "4321"}
    mocked.assert_called_once_with(
        hwnd="4321",
        target_rect={"left": 100, "top": 200, "right": 500, "bottom": 600},
        animate=False,
        duration_ms=180,
    )
