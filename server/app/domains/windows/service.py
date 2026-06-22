"""Windows 窗口能力服务"""

from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

from app.domains.windows.border_manager import TopmostBorderManager

GA_ROOTOWNER = 3
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SW_SHOWNOACTIVATE = 4
DWMWA_EXTENDED_FRAME_BOUNDS = 9


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

MONITOR_DEFAULTTONEAREST = 2


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", wintypes.DWORD),
    ]


if sys.platform == "win32":
    _USER32 = ctypes.WinDLL("user32", use_last_error=True)
    _DWMAPI = ctypes.WinDLL("dwmapi", use_last_error=True)
    _USER32.WindowFromPoint.argtypes = [POINT]
    _USER32.WindowFromPoint.restype = wintypes.HWND
    _USER32.GetForegroundWindow.argtypes = []
    _USER32.GetForegroundWindow.restype = wintypes.HWND
    _USER32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    _USER32.GetAncestor.restype = wintypes.HWND
    _USER32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    _USER32.GetWindowTextLengthW.restype = ctypes.c_int
    _USER32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    _USER32.GetWindowTextW.restype = ctypes.c_int
    _USER32.IsWindowVisible.argtypes = [wintypes.HWND]
    _USER32.IsWindowVisible.restype = wintypes.BOOL
    _USER32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    _USER32.GetWindowRect.restype = wintypes.BOOL
    _USER32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    _USER32.GetWindowThreadProcessId.restype = wintypes.DWORD
    _USER32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    _USER32.SetWindowPos.restype = wintypes.BOOL
    _USER32.SetForegroundWindow.argtypes = [wintypes.HWND]
    _USER32.SetForegroundWindow.restype = wintypes.BOOL
    _USER32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    _USER32.ShowWindow.restype = wintypes.BOOL
    _USER32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
    _USER32.EnumWindows.restype = wintypes.BOOL
    _USER32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    _USER32.MonitorFromWindow.restype = wintypes.HANDLE
    _USER32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
    _USER32.GetMonitorInfoW.restype = wintypes.BOOL
    _DWMAPI.DwmGetWindowAttribute.argtypes = [
        wintypes.HWND,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    _DWMAPI.DwmGetWindowAttribute.restype = ctypes.c_long
else:
    _USER32 = None
    _DWMAPI = None

_BORDER_MANAGER = TopmostBorderManager()


def _require_windows() -> None:
    if sys.platform != "win32" or _USER32 is None:
        raise RuntimeError("Windows 窗口能力仅支持 win32")


def _normalize_hwnd(hwnd: str) -> int:
    value = hwnd.strip()
    if not value:
        return 0
    try:
        parsed = int(value, 10)
    except ValueError:
        return 0
    return parsed if parsed > 0 else 0


def _root_hwnd(hwnd: int) -> int:
    _require_windows()
    root = _USER32.GetAncestor(wintypes.HWND(hwnd), GA_ROOTOWNER)
    return int(root) if root else hwnd


def _window_title(hwnd: int) -> str:
    _require_windows()
    length = _USER32.GetWindowTextLengthW(wintypes.HWND(hwnd))
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    _USER32.GetWindowTextW(wintypes.HWND(hwnd), buffer, len(buffer))
    return buffer.value or ""


def get_window_from_point(x: int, y: int, node_pid: int = 0) -> dict[str, str] | None:
    """按屏幕坐标获取可见外部窗口"""

    _require_windows()
    hwnd = _USER32.WindowFromPoint(POINT(int(x), int(y)))
    if not hwnd:
        return None
    root = _root_hwnd(int(hwnd))
    if not root:
        return None
    if not _USER32.IsWindowVisible(wintypes.HWND(root)):
        return None

    process_id = wintypes.DWORD(0)
    _USER32.GetWindowThreadProcessId(wintypes.HWND(root), ctypes.byref(process_id))
    if node_pid and int(process_id.value) == int(node_pid):
        return None

    return {"hwnd": str(root), "title": _window_title(root)}


def set_window_topmost(hwnd: str, topmost: bool) -> bool:
    """设置窗口是否置顶"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return False

    root = _root_hwnd(parsed_hwnd)
    if not root:
        return False

    flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    insert_after = HWND_TOPMOST if topmost else HWND_NOTOPMOST
    try:
        _USER32.ShowWindow(wintypes.HWND(root), SW_SHOWNOACTIVATE)
    except OSError:
        pass

    result = _USER32.SetWindowPos(
        wintypes.HWND(root),
        wintypes.HWND(insert_after),
        0,
        0,
        0,
        0,
        flags,
    )
    return bool(result)


def get_window_root(hwnd: str) -> dict[str, str] | None:
    """获取窗口所属 root hwnd。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return None
    root = _root_hwnd(parsed_hwnd)
    if not root:
        return None
    return {"hwnd": str(root)}


def get_foreground_window(node_pid: int = 0) -> dict[str, str] | None:
    """获取当前前台外部窗口"""

    _require_windows()
    hwnd = _USER32.GetForegroundWindow()
    if not hwnd:
        return None

    process_id = wintypes.DWORD(0)
    _USER32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(process_id))
    if node_pid and int(process_id.value) == int(node_pid):
        return None

    hwnd_int = int(hwnd)
    return {"hwnd": str(hwnd_int), "title": _window_title(hwnd_int)}


def get_window_rect(hwnd: str) -> dict[str, int] | None:
    """获取窗口矩形，优先返回 DWM 可见边界。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return None

    rect = RECT()
    if _DWMAPI is not None:
        hr = _DWMAPI.DwmGetWindowAttribute(
            wintypes.HWND(parsed_hwnd),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            ctypes.byref(rect),
            ctypes.sizeof(rect),
        )
        if hr == 0:
            return {
                "left": int(rect.left),
                "top": int(rect.top),
                "right": int(rect.right),
                "bottom": int(rect.bottom),
            }

    if not _USER32.GetWindowRect(wintypes.HWND(parsed_hwnd), ctypes.byref(rect)):
        return None
    return {
        "left": int(rect.left),
        "top": int(rect.top),
        "right": int(rect.right),
        "bottom": int(rect.bottom),
    }


def raise_window(hwnd: str) -> bool:
    """将窗口抬到前台可见层级。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return False

    root = _root_hwnd(parsed_hwnd)
    if not root:
        return False

    flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    try:
        _USER32.ShowWindow(wintypes.HWND(root), SW_SHOWNOACTIVATE)
    except OSError:
        pass

    try:
        topmost_ok = _USER32.SetWindowPos(
            wintypes.HWND(root),
            wintypes.HWND(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            flags,
        )
        notopmost_ok = _USER32.SetWindowPos(
            wintypes.HWND(root),
            wintypes.HWND(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            flags,
        )
    except OSError:
        return False
    return bool(topmost_ok and notopmost_ok)


def sync_topmost_borders(*, enabled: bool, color: str, width: int, hwnds: list[str]) -> int:
    """同步置顶边框目标集合。"""

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in hwnds:
        if not isinstance(raw, str):
            continue
        hwnd = raw.strip()
        if not hwnd or hwnd in seen:
            continue
        seen.add(hwnd)
        normalized.append(hwnd)
    return _BORDER_MANAGER.sync(enabled=enabled, color=color, width=width, hwnds=normalized)


def clear_topmost_borders() -> int:
    """清空所有置顶边框。"""

    return _BORDER_MANAGER.clear()


def activate_window(hwnd: str) -> bool:
    """激活（设为前台）外部窗口。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return False

    try:
        return bool(_USER32.SetForegroundWindow(wintypes.HWND(parsed_hwnd)))
    except OSError:
        return False


def find_windows_by_title(title: str, match: str, limit: int) -> list[dict[str, str]]:
    """按标题搜索外部窗口。"""

    _require_windows()

    if not title:
        return []

    limit = max(1, min(limit, 50))
    match = match if match in ("contains", "equals") else "contains"
    results: list[dict[str, str]] = []

    def _enum_proc(hwnd: int, _lparam: int) -> bool:
        if len(results) >= limit:
            return False
        if not _USER32.IsWindowVisible(wintypes.HWND(hwnd)):
            return True

        t = _window_title(hwnd)
        if not t:
            return True

        if match == "equals":
            ok = t == title
        else:
            ok = title.lower() in t.lower()

        if ok:
            results.append({"hwnd": str(hwnd), "title": t})
        return len(results) < limit

    callback = WNDENUMPROC(_enum_proc)
    _USER32.EnumWindows(callback, 0)
    return results


def hide_window_to_edge(
    hwnd: str,
    edge: str,
    peek_px: int,
    animate: bool,
    duration_ms: int,
) -> dict:
    """将窗口隐藏到屏幕边缘。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return {"ok": False, "hwnd": ""}

    rect = RECT()
    if not _USER32.GetWindowRect(wintypes.HWND(parsed_hwnd), ctypes.byref(rect)):
        return {"ok": False, "hwnd": hwnd}

    w = rect.right - rect.left
    h = rect.bottom - rect.top

    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    monitor = _USER32.MonitorFromWindow(wintypes.HWND(parsed_hwnd), MONITOR_DEFAULTTONEAREST)
    if not _USER32.GetMonitorInfoW(monitor, ctypes.byref(mi)):
        return {"ok": False, "hwnd": hwnd}

    sx = rect.left
    sy = rect.top
    edge = edge if edge in ("left", "right", "top", "bottom") else "left"
    peek = max(0, min(peek_px, 400))

    if edge == "left":
        x = mi.rcWork.left + peek - w
        y = rect.top
    elif edge == "right":
        x = mi.rcWork.right - peek
        y = rect.top
    elif edge == "top":
        x = rect.left
        y = mi.rcWork.top + peek - h
    else:
        x = rect.left
        y = mi.rcWork.bottom - peek

    flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW  # no SWP_NOMOVE
    _do_animate_move(parsed_hwnd, sx, sy, x, y, animate, duration_ms, flags)

    return {
        "ok": True,
        "hwnd": hwnd,
        "rect": {
            "left": int(rect.left),
            "top": int(rect.top),
            "right": int(rect.right),
            "bottom": int(rect.bottom),
        },
        "new_pos": {"x": int(x), "y": int(y)},
    }


def restore_window(
    hwnd: str,
    target_rect: dict[str, int],
    animate: bool,
    duration_ms: int,
) -> dict:
    """将窗口恢复到指定位置。"""

    _require_windows()
    parsed_hwnd = _normalize_hwnd(hwnd)
    if not parsed_hwnd:
        return {"ok": False, "hwnd": ""}

    x = int(target_rect.get("left", 0))
    y = int(target_rect.get("top", 0))

    cur = RECT()
    sx = x
    sy = y
    if _USER32.GetWindowRect(wintypes.HWND(parsed_hwnd), ctypes.byref(cur)):
        sx = cur.left
        sy = cur.top

    flags = SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    _do_animate_move(parsed_hwnd, sx, sy, x, y, animate, duration_ms, flags)

    return {"ok": True, "hwnd": hwnd}


def _do_animate_move(
    hwnd: int,
    sx: int,
    sy: int,
    dx: int,
    dy: int,
    animate: bool,
    duration_ms: int,
    flags: int,
) -> None:
    """带动画或无动画移动窗口。"""

    import time  # noqa: PLC0415

    if not animate:
        _USER32.SetWindowPos(
            wintypes.HWND(hwnd),
            None,
            dx,
            dy,
            0,
            0,
            flags,
        )
        return

    steps = max(8, min(24, duration_ms // 12))
    sleep_ms = max(1, duration_ms // steps)
    for i in range(1, steps + 1):
        nx = round(sx + (dx - sx) * i / steps)
        ny = round(sy + (dy - sy) * i / steps)
        _USER32.SetWindowPos(
            wintypes.HWND(hwnd),
            None,
            nx,
            ny,
            0,
            0,
            flags,
        )
        time.sleep(sleep_ms / 1000.0)


def shutdown_windows_runtime() -> None:
    """关闭 Windows 域运行时，确保 overlay/hook 全部释放。"""

    _BORDER_MANAGER.shutdown()
