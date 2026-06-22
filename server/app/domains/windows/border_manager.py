"""置顶边框管理器。

这一层负责：
- 管理被标记为 topmost 的目标窗口集合
- 通过 Win32 hook 监听目标窗口移动、激活、隐藏、销毁
- 用单个圆角 overlay 窗口绘制边框，并贴合窗口真实可见区域
"""

from __future__ import annotations

import ctypes
import math
import sys
import threading
from ctypes import wintypes
from dataclasses import dataclass

GA_ROOTOWNER = 3
EVENT_SYSTEM_FOREGROUND = 0x0003
EVENT_OBJECT_DESTROY = 0x8001
EVENT_OBJECT_HIDE = 0x8003
EVENT_OBJECT_LOCATIONCHANGE = 0x800B
WINEVENT_OUTOFCONTEXT = 0x0000
WINEVENT_SKIPOWNPROCESS = 0x0002
OBJID_WINDOW = 0
CHILDID_SELF = 0

WM_TIMER = 0x0113
WM_QUIT = 0x0012
WM_APP_SYNC = 0x8000 + 1

SW_HIDE = 0
SW_SHOWNOACTIVATE = 4

WS_POPUP = 0x80000000
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008
WS_EX_NOACTIVATE = 0x08000000

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
HWND_TOPMOST = -1

TIMER_RECONCILE = 1
WATCHDOG_INTERVAL_MS = 1000
DWMWA_EXTENDED_FRAME_BOUNDS = 9
BORDER_CORNER_RADIUS = 14
AC_SRC_OVER = 0x00
AC_SRC_ALPHA = 0x01
ULW_ALPHA = 0x02
BI_RGB = 0
DIB_RGB_COLORS = 0

CLASS_NAME = "ForgeStudioTopmostBorderOverlay"
LRESULT = getattr(wintypes, "LRESULT", ctypes.c_ssize_t)
HCURSOR = getattr(wintypes, "HCURSOR", wintypes.HANDLE)
HBRUSH = getattr(wintypes, "HBRUSH", wintypes.HANDLE)
HICON = getattr(wintypes, "HICON", wintypes.HANDLE)
HINSTANCE = getattr(wintypes, "HINSTANCE", wintypes.HANDLE)
HMODULE = getattr(wintypes, "HMODULE", wintypes.HANDLE)
HMENU = getattr(wintypes, "HMENU", wintypes.HANDLE)
HGDIOBJ = getattr(wintypes, "HGDIOBJ", wintypes.HANDLE)
UINT_PTR = getattr(wintypes, "UINT_PTR", ctypes.c_size_t)


@dataclass
class BorderStyle:
    enabled: bool
    color: str
    width: int


@dataclass
class BorderTarget:
    hwnd: str
    root_hwnd: int
    overlay_hwnd: int = 0
    visible: bool = False
    rect: tuple[int, int, int, int] | None = None
    render_key: tuple[int, int, int, str] | None = None


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", wintypes.POINT),
    ]


class SIZE(ctypes.Structure):
    _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", BITMAPINFOHEADER),
        ("bmiColors", wintypes.DWORD * 3),
    ]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [
        ("BlendOp", ctypes.c_ubyte),
        ("BlendFlags", ctypes.c_ubyte),
        ("SourceConstantAlpha", ctypes.c_ubyte),
        ("AlphaFormat", ctypes.c_ubyte),
    ]


WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT,
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HINSTANCE),
        ("hIcon", HICON),
        ("hCursor", HCURSOR),
        ("hbrBackground", HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


if sys.platform == "win32":
    _USER32 = ctypes.WinDLL("user32", use_last_error=True)
    _KERNEL32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _GDI32 = ctypes.WinDLL("gdi32", use_last_error=True)
    _DWMAPI = ctypes.WinDLL("dwmapi", use_last_error=True)

    _KERNEL32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    _KERNEL32.GetModuleHandleW.restype = HMODULE

    _USER32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    _USER32.RegisterClassW.restype = wintypes.ATOM
    _USER32.CreateWindowExW.argtypes = [
        wintypes.DWORD,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        HMENU,
        HINSTANCE,
        wintypes.LPVOID,
    ]
    _USER32.CreateWindowExW.restype = wintypes.HWND
    _USER32.DefWindowProcW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    _USER32.DefWindowProcW.restype = LRESULT
    _USER32.DestroyWindow.argtypes = [wintypes.HWND]
    _USER32.DestroyWindow.restype = wintypes.BOOL
    _USER32.SetWindowRgn.argtypes = [wintypes.HWND, wintypes.HRGN, wintypes.BOOL]
    _USER32.SetWindowRgn.restype = ctypes.c_int
    _USER32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    _USER32.ShowWindow.restype = wintypes.BOOL
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
    _USER32.InvalidateRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT), wintypes.BOOL]
    _USER32.InvalidateRect.restype = wintypes.BOOL
    _USER32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    _USER32.GetWindowRect.restype = wintypes.BOOL
    _USER32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    _USER32.GetAncestor.restype = wintypes.HWND
    _USER32.IsWindow.argtypes = [wintypes.HWND]
    _USER32.IsWindow.restype = wintypes.BOOL
    _USER32.IsWindowVisible.argtypes = [wintypes.HWND]
    _USER32.IsWindowVisible.restype = wintypes.BOOL
    _USER32.IsIconic.argtypes = [wintypes.HWND]
    _USER32.IsIconic.restype = wintypes.BOOL
    _USER32.GetMessageW.argtypes = [ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    _USER32.GetMessageW.restype = wintypes.BOOL
    _USER32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
    _USER32.TranslateMessage.restype = wintypes.BOOL
    _USER32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
    _USER32.DispatchMessageW.restype = LRESULT
    _USER32.PostThreadMessageW.argtypes = [
        wintypes.DWORD,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    ]
    _USER32.PostThreadMessageW.restype = wintypes.BOOL
    _USER32.SetTimer.argtypes = [wintypes.HWND, UINT_PTR, wintypes.UINT, wintypes.LPVOID]
    _USER32.SetTimer.restype = UINT_PTR
    _USER32.KillTimer.argtypes = [wintypes.HWND, UINT_PTR]
    _USER32.KillTimer.restype = wintypes.BOOL
    _USER32.SetWinEventHook.argtypes = [
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HMODULE,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    _USER32.SetWinEventHook.restype = wintypes.HANDLE
    _USER32.UnhookWinEvent.argtypes = [wintypes.HANDLE]
    _USER32.UnhookWinEvent.restype = wintypes.BOOL
    _USER32.GetDC.argtypes = [wintypes.HWND]
    _USER32.GetDC.restype = wintypes.HDC
    _USER32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    _USER32.ReleaseDC.restype = ctypes.c_int
    _USER32.UpdateLayeredWindow.argtypes = [
        wintypes.HWND,
        wintypes.HDC,
        ctypes.POINTER(wintypes.POINT),
        ctypes.POINTER(SIZE),
        wintypes.HDC,
        ctypes.POINTER(wintypes.POINT),
        wintypes.COLORREF,
        ctypes.POINTER(BLENDFUNCTION),
        wintypes.DWORD,
    ]
    _USER32.UpdateLayeredWindow.restype = wintypes.BOOL
    _USER32.SetProcessDPIAware.argtypes = []
    _USER32.SetProcessDPIAware.restype = wintypes.BOOL

    _GDI32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    _GDI32.CreateCompatibleDC.restype = wintypes.HDC
    _GDI32.DeleteDC.argtypes = [wintypes.HDC]
    _GDI32.DeleteDC.restype = wintypes.BOOL
    _GDI32.SelectObject.argtypes = [wintypes.HDC, HGDIOBJ]
    _GDI32.SelectObject.restype = HGDIOBJ
    _GDI32.CreateDIBSection.argtypes = [
        wintypes.HDC,
        ctypes.POINTER(BITMAPINFO),
        wintypes.UINT,
        ctypes.POINTER(ctypes.c_void_p),
        wintypes.HANDLE,
        wintypes.DWORD,
    ]
    _GDI32.CreateDIBSection.restype = wintypes.HBITMAP
    _GDI32.DeleteObject.argtypes = [HGDIOBJ]
    _GDI32.DeleteObject.restype = wintypes.BOOL
    _DWMAPI.DwmGetWindowAttribute.argtypes = [
        wintypes.HWND,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    _DWMAPI.DwmGetWindowAttribute.restype = ctypes.c_long
else:
    _USER32 = None
    _KERNEL32 = None
    _GDI32 = None
    _DWMAPI = None


_CLASS_REGISTERED = False
_WNDPROC_REF: WNDPROC | None = None


def _rgb_to_colorref(r: int, g: int, b: int) -> int:
    return (b << 16) | (g << 8) | r


def _parse_hex_color(value: str) -> tuple[int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    alpha = 255
    if len(raw) == 8:
        alpha = int(raw[6:8], 16)
        raw = raw[:6]
    r = int(raw[0:2], 16)
    g = int(raw[2:4], 16)
    b = int(raw[4:6], 16)
    return _rgb_to_colorref(r, g, b), alpha


def _overlay_wndproc(hwnd: int, msg: int, w_param: int, l_param: int) -> int:
    if _USER32 is None:
        return 0
    return _USER32.DefWindowProcW(hwnd, msg, w_param, l_param)


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value


def _rounded_rect_signed_distance(
    x: float,
    y: float,
    width_px: int,
    height_px: int,
    radius: float,
) -> float:
    half_w = width_px / 2.0
    half_h = height_px / 2.0
    cx = half_w
    cy = half_h
    qx = abs(x - cx) - max(half_w - radius, 0.0)
    qy = abs(y - cy) - max(half_h - radius, 0.0)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def _build_border_bitmap_bytes(
    width_px: int,
    height_px: int,
    border_px: int,
    colorref: int,
    alpha: int,
    radius: int,
) -> bytearray:
    width_px = max(1, int(width_px))
    height_px = max(1, int(height_px))
    border_px = max(1, min(32, int(border_px)))
    radius = max(float(border_px + 1), min(float(radius), min(width_px, height_px) / 2.0))

    inner_width = max(1, width_px - border_px * 2)
    inner_height = max(1, height_px - border_px * 2)
    inner_radius = max(0.0, radius - border_px)

    red = colorref & 0xFF
    green = (colorref >> 8) & 0xFF
    blue = (colorref >> 16) & 0xFF

    pixels = bytearray(width_px * height_px * 4)
    for y in range(height_px):
        py = y + 0.5
        for x in range(width_px):
            px = x + 0.5
            outer_sd = _rounded_rect_signed_distance(px, py, width_px, height_px, radius)
            outer_cov = _clamp01(0.5 - outer_sd)

            inner_cov = 0.0
            if inner_width > 0 and inner_height > 0:
                inner_sd = _rounded_rect_signed_distance(
                    px - border_px,
                    py - border_px,
                    inner_width,
                    inner_height,
                    inner_radius,
                )
                inner_cov = _clamp01(0.5 - inner_sd)

            ring_cov = _clamp01(outer_cov - inner_cov)
            if ring_cov <= 0.0:
                continue

            pixel_alpha = int(alpha * ring_cov)
            if pixel_alpha <= 0:
                continue
            idx = (y * width_px + x) * 4
            pixels[idx + 0] = (blue * pixel_alpha) // 255
            pixels[idx + 1] = (green * pixel_alpha) // 255
            pixels[idx + 2] = (red * pixel_alpha) // 255
            pixels[idx + 3] = pixel_alpha
    return pixels


def _ensure_overlay_class_registered() -> None:
    global _CLASS_REGISTERED, _WNDPROC_REF
    if _CLASS_REGISTERED or _USER32 is None or _KERNEL32 is None:
        return
    _WNDPROC_REF = WNDPROC(_overlay_wndproc)
    wc = WNDCLASSW()
    wc.lpfnWndProc = _WNDPROC_REF
    wc.hInstance = _KERNEL32.GetModuleHandleW(None)
    wc.lpszClassName = CLASS_NAME
    atom = _USER32.RegisterClassW(ctypes.byref(wc))
    if atom == 0 and ctypes.get_last_error() not in (0, 1410):
        raise ctypes.WinError(ctypes.get_last_error())
    _CLASS_REGISTERED = True


WinEventProc = ctypes.WINFUNCTYPE(
    None,
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.HWND,
    ctypes.c_long,
    ctypes.c_long,
    wintypes.DWORD,
    wintypes.DWORD,
)


class TopmostBorderManager:
    def __init__(self, start_runtime: bool = True) -> None:
        self._targets: dict[str, BorderTarget] = {}
        self._style = BorderStyle(enabled=True, color="#3b82f6", width=3)
        self._lock = threading.RLock()
        self._pending_destroy: list[tuple[int, ...]] = []
        self._thread: threading.Thread | None = None
        self._thread_id = 0
        self._thread_ready = threading.Event()
        self._hooks: list[int] = []
        self._start_runtime = start_runtime
        self._runtime_started = False
        self._win_event_proc = WinEventProc(self._handle_win_event)

    def sync(self, *, enabled: bool, color: str, width: int, hwnds: list[str]) -> int:
        with self._lock:
            self._style = BorderStyle(enabled=enabled, color=color, width=width)
            desired = list(hwnds if enabled else [])
            desired_set = set(desired)

            for hwnd in list(self._targets):
                if hwnd not in desired_set:
                    self._remove_target_locked(hwnd)

            for hwnd in desired:
                target = self._targets.get(hwnd)
                if isinstance(target, BorderTarget):
                    continue
                root_hwnd = self._resolve_root_hwnd(hwnd)
                if not root_hwnd:
                    continue
                self._targets[hwnd] = BorderTarget(hwnd=hwnd, root_hwnd=root_hwnd)

            count = len(self._targets)

        if enabled and self._start_runtime and self._is_win32():
            self._ensure_runtime()
        self._request_reconcile()
        return count

    def clear(self) -> int:
        with self._lock:
            removed = len(self._targets)
            for hwnd in list(self._targets):
                self._remove_target_locked(hwnd)
        self._request_reconcile()
        return removed

    def shutdown(self) -> None:
        self.clear()
        thread_id = self._thread_id
        if thread_id:
            _USER32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=1.5)
        self._thread = None
        self._thread_id = 0
        self._runtime_started = False
        self._thread_ready.clear()

    def _remove_target_locked(self, hwnd: str) -> None:
        target = self._targets.pop(hwnd, None)
        if isinstance(target, BorderTarget) and target.overlay_hwnd:
            self._pending_destroy.append((target.overlay_hwnd,))

    def _request_reconcile(self) -> None:
        if not self._thread_id or _USER32 is None:
            return
        _USER32.PostThreadMessageW(self._thread_id, WM_APP_SYNC, 0, 0)

    def _ensure_runtime(self) -> None:
        if not self._is_win32():
            return
        if self._runtime_started:
            return
        self._runtime_started = True
        self._thread_ready.clear()
        self._thread = threading.Thread(target=self._thread_main, name="topmost-border-ui", daemon=True)
        self._thread.start()
        self._thread_ready.wait(timeout=2.0)

    def _thread_main(self) -> None:
        if _USER32 is None:
            return
        self._thread_id = threading.get_native_id()
        try:
            _USER32.SetProcessDPIAware()
        except Exception:
            pass
        _ensure_overlay_class_registered()
        self._install_hooks()
        _USER32.SetTimer(None, TIMER_RECONCILE, WATCHDOG_INTERVAL_MS, None)
        self._thread_ready.set()
        self._reconcile_targets()

        msg = MSG()
        while _USER32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if not msg.hwnd:
                if msg.message in (WM_APP_SYNC, WM_TIMER):
                    self._reconcile_targets()
                    continue
            _USER32.TranslateMessage(ctypes.byref(msg))
            _USER32.DispatchMessageW(ctypes.byref(msg))

        _USER32.KillTimer(None, TIMER_RECONCILE)
        self._uninstall_hooks()
        self._destroy_all_overlays()

    def _install_hooks(self) -> None:
        if _USER32 is None:
            return
        if self._hooks:
            return
        for event_min, event_max in (
            (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
            (EVENT_OBJECT_HIDE, EVENT_OBJECT_HIDE),
            (EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY),
        ):
            hook = _USER32.SetWinEventHook(
                event_min,
                event_max,
                None,
                self._win_event_proc,
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
            if hook:
                self._hooks.append(int(hook))

    def _uninstall_hooks(self) -> None:
        if _USER32 is None:
            return
        for hook in self._hooks:
            try:
                _USER32.UnhookWinEvent(hook)
            except Exception:
                pass
        self._hooks.clear()

    def _handle_win_event(
        self,
        _hook: int,
        event_type: int,
        hwnd: int,
        id_object: int,
        id_child: int,
        _thread: int,
        _time_ms: int,
    ) -> None:
        if not hwnd:
            return
        if id_object != OBJID_WINDOW or id_child != CHILDID_SELF:
            return
        root = self._get_root_hwnd(hwnd)
        if not root:
            return
        force_raise = event_type == EVENT_SYSTEM_FOREGROUND
        target_key: str | None = None
        with self._lock:
            for key, target in self._targets.items():
                if isinstance(target, BorderTarget) and target.root_hwnd == root:
                    target_key = key
                    break
        if not target_key:
            return
        self._refresh_one(target_key, force_raise=force_raise)

    def _reconcile_targets(self) -> None:
        pending: list[tuple[int, ...]]
        keys: list[str]
        with self._lock:
            pending = self._pending_destroy[:]
            self._pending_destroy.clear()
            keys = list(self._targets.keys())
        for overlay_set in pending:
            self._destroy_overlay_set(overlay_set)
        for hwnd in keys:
            self._refresh_one(hwnd, force_raise=False)

    def _refresh_one(self, hwnd: str, force_raise: bool) -> None:
        if not self._is_win32():
            return
        with self._lock:
            target = self._targets.get(hwnd)
            style = self._style
        if not isinstance(target, BorderTarget):
            return
        if not style.enabled:
            self._hide_target(target)
            return
        if not self._USER32_window_ok(target.root_hwnd):
            with self._lock:
                self._remove_target_locked(hwnd)
            self._request_reconcile()
            return
        rect = self._get_window_rect(target.root_hwnd)
        if (
            rect is None
            or not self._is_window_visible(target.root_hwnd)
            or self._is_window_minimized(target.root_hwnd)
        ):
            self._hide_target(target)
            return
        overlay_hwnd = target.overlay_hwnd or self._create_overlay(style)
        if not overlay_hwnd:
            return
        self._update_overlay_style(overlay_hwnd, style)
        self._set_overlay_bounds(overlay_hwnd, rect, style.width, force_raise=force_raise)
        with self._lock:
            latest = self._targets.get(hwnd)
            if isinstance(latest, BorderTarget):
                latest.overlay_hwnd = overlay_hwnd
                latest.visible = True
                latest.rect = rect

    def _hide_target(self, target: BorderTarget) -> None:
        if not target.overlay_hwnd or _USER32 is None:
            return
        _USER32.ShowWindow(target.overlay_hwnd, SW_HIDE)
        with self._lock:
            latest = self._targets.get(target.hwnd)
            if isinstance(latest, BorderTarget):
                latest.visible = False

    def _create_overlay(self, style: BorderStyle) -> int:
        if _USER32 is None or _KERNEL32 is None:
            return 0
        _ensure_overlay_class_registered()
        h_instance = _KERNEL32.GetModuleHandleW(None)
        hwnd = _USER32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            CLASS_NAME,
            "",
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            h_instance,
            None,
        )
        if not hwnd:
            return 0
        hwnd_int = int(hwnd)
        return hwnd_int

    def _update_overlay_style(self, overlay_hwnd: int, style: BorderStyle) -> None:
        # ARGB layered window directly uses bitmap alpha, no window-wide alpha path here.
        return

    def _set_overlay_bounds(
        self,
        overlay_hwnd: int,
        rect: tuple[int, int, int, int],
        width: int,
        *,
        force_raise: bool,
    ) -> None:
        if _USER32 is None or not overlay_hwnd:
            return
        left, top, right, bottom = rect
        border = max(1, min(16, int(width)))
        width_px = max(1, right - left)
        height_px = max(1, bottom - top)
        render_key = (width_px, height_px, border, self._style.color)

        repaint = False
        with self._lock:
            for target in self._targets.values():
                if not isinstance(target, BorderTarget):
                    continue
                if target.overlay_hwnd != overlay_hwnd:
                    continue
                repaint = target.render_key != render_key
                target.render_key = render_key
                break

        if repaint:
            self._update_overlay_bitmap(overlay_hwnd, width_px, height_px, border, self._style.color)

        flags = SWP_NOACTIVATE | SWP_SHOWWINDOW
        _USER32.SetWindowPos(overlay_hwnd, HWND_TOPMOST, left, top, width_px, height_px, flags)
        if force_raise:
            _USER32.SetWindowPos(
                overlay_hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        _USER32.ShowWindow(overlay_hwnd, SW_SHOWNOACTIVATE)

    def _update_overlay_bitmap(
        self,
        overlay_hwnd: int,
        width_px: int,
        height_px: int,
        border: int,
        color: str,
    ) -> None:
        if _USER32 is None or _GDI32 is None or not overlay_hwnd:
            return
        colorref, alpha = _parse_hex_color(color)
        radius = min(BORDER_CORNER_RADIUS, max(border + 2, min(width_px, height_px) // 2))
        bitmap_bytes = _build_border_bitmap_bytes(width_px, height_px, border, colorref, alpha, radius)

        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width_px
        bmi.bmiHeader.biHeight = -height_px
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = BI_RGB

        screen_dc = _USER32.GetDC(None)
        mem_dc = _GDI32.CreateCompatibleDC(screen_dc)
        bits_ptr = ctypes.c_void_p()
        dib = _GDI32.CreateDIBSection(
            screen_dc,
            ctypes.byref(bmi),
            DIB_RGB_COLORS,
            ctypes.byref(bits_ptr),
            None,
            0,
        )
        old_obj = None
        try:
            if not dib or not bits_ptr.value or not mem_dc:
                return
            ctypes.memmove(bits_ptr.value, bytes(bitmap_bytes), len(bitmap_bytes))
            old_obj = _GDI32.SelectObject(mem_dc, dib)
            dst_pt = wintypes.POINT(0, 0)
            src_pt = wintypes.POINT(0, 0)
            size = SIZE(width_px, height_px)
            blend = BLENDFUNCTION(AC_SRC_OVER, 0, 255, AC_SRC_ALPHA)
            _USER32.UpdateLayeredWindow(
                overlay_hwnd,
                screen_dc,
                None,
                ctypes.byref(size),
                mem_dc,
                ctypes.byref(src_pt),
                0,
                ctypes.byref(blend),
                ULW_ALPHA,
            )
        finally:
            if old_obj:
                _GDI32.SelectObject(mem_dc, old_obj)
            if dib:
                _GDI32.DeleteObject(dib)
            if mem_dc:
                _GDI32.DeleteDC(mem_dc)
            if screen_dc:
                _USER32.ReleaseDC(None, screen_dc)

    def _destroy_overlay_set(self, overlay_hwnds: tuple[int, ...]) -> None:
        if _USER32 is None:
            return
        for hwnd in overlay_hwnds:
            if self._USER32_window_ok(int(hwnd)):
                _USER32.DestroyWindow(hwnd)

    def _destroy_all_overlays(self) -> None:
        with self._lock:
            overlay_sets = [
                (target.overlay_hwnd,)
                for target in self._targets.values()
                if isinstance(target, BorderTarget) and target.overlay_hwnd
            ]
            overlay_sets.extend(self._pending_destroy)
            self._pending_destroy.clear()
            for target in self._targets.values():
                if isinstance(target, BorderTarget):
                    target.overlay_hwnd = 0
                    target.visible = False
                    target.render_key = None
        for overlay_set in overlay_sets:
            self._destroy_overlay_set(overlay_set)

    def _resolve_root_hwnd(self, hwnd: str) -> int:
        try:
            parsed = int(hwnd, 10)
        except ValueError:
            return 0
        if parsed <= 0:
            return 0
        return self._get_root_hwnd(parsed)

    def _get_root_hwnd(self, hwnd: int) -> int:
        if _USER32 is None:
            return hwnd
        root = _USER32.GetAncestor(hwnd, GA_ROOTOWNER)
        return int(root) if root else int(hwnd)

    def _get_window_rect(self, hwnd: int) -> tuple[int, int, int, int] | None:
        if _USER32 is None:
            return None
        rect = RECT()
        if _DWMAPI is not None:
            hr = _DWMAPI.DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                ctypes.byref(rect),
                ctypes.sizeof(rect),
            )
            if hr == 0:
                return (int(rect.left), int(rect.top), int(rect.right), int(rect.bottom))
        if not _USER32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        return (int(rect.left), int(rect.top), int(rect.right), int(rect.bottom))

    def _is_window_visible(self, hwnd: int) -> bool:
        return bool(_USER32 and _USER32.IsWindowVisible(hwnd))

    def _is_window_minimized(self, hwnd: int) -> bool:
        return bool(_USER32 and _USER32.IsIconic(hwnd))

    def _USER32_window_ok(self, hwnd: int) -> bool:
        return bool(_USER32 and hwnd and _USER32.IsWindow(hwnd))

    def _is_win32(self) -> bool:
        return sys.platform == "win32" and _USER32 is not None
