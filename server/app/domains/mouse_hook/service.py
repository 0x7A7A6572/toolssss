"""全局鼠标钩子服务

使用 SetWindowsHookEx(WH_MOUSE_LL) 监听中键按住拖拽手势。
"""

from __future__ import annotations

import ctypes
import json
import sys
import threading
import traceback
from ctypes import c_int, c_void_p, wintypes
from urllib import request as urllib_request

# ---------------------------------------------------------------------------
# Windows 常量
# ---------------------------------------------------------------------------

# 钩子类型
WH_MOUSE_LL = 14      # 低级鼠标钩子（全局）
WH_KEYBOARD_LL = 13   # 低级键盘钩子（全局）

# 鼠标消息
WM_MBUTTONDOWN = 0x0207   # 中键按下
WM_MBUTTONUP = 0x0208     # 中键松开
WM_MOUSEMOVE = 0x0200     # 鼠标移动

# 键盘消息
WM_KEYDOWN = 0x0100       # 普通键按下
WM_SYSKEYDOWN = 0x0104    # 系统键按下（Alt 组合键等）

# 虚拟键码
VK_ESCAPE = 0x1B          # ESC 键

# ---------------------------------------------------------------------------
# Win32 API（模块级，argtypes/restype 只设置一次）
# ---------------------------------------------------------------------------

_user32 = ctypes.WinDLL("user32", use_last_error=True)

_user32.SetWindowsHookExW.argtypes = [c_int, c_void_p, wintypes.HINSTANCE, wintypes.DWORD]
_user32.SetWindowsHookExW.restype = wintypes.HHOOK

_user32.CallNextHookEx.argtypes = [wintypes.HHOOK, c_int, wintypes.WPARAM, wintypes.LPARAM]
_user32.CallNextHookEx.restype = wintypes.LPARAM

_user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
_user32.UnhookWindowsHookEx.restype = wintypes.BOOL

_user32.GetMessageW.argtypes = [
    ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT
]
_user32.GetMessageW.restype = wintypes.BOOL

_user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
_user32.TranslateMessage.restype = wintypes.BOOL

_user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
_user32.DispatchMessageW.restype = wintypes.LPARAM

_user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_user32.PostThreadMessageW.restype = wintypes.BOOL

# ---------------------------------------------------------------------------
# HOOKPROC 类型
# ---------------------------------------------------------------------------

HOOKPROC = ctypes.WINFUNCTYPE(wintypes.LPARAM, c_int, wintypes.WPARAM, wintypes.LPARAM)


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", wintypes.POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", c_void_p),
    ]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", c_void_p),
    ]


def _log(msg: str) -> None:
    print(f"[MouseHook] {msg}", flush=True)


class GlobalMouseHook:
    """全局鼠标钩子单例"""

    def __init__(self) -> None:
        self._hook_id: int = 0
        self._callback_ref: HOOKPROC | None = None
        self._keyboard_callback_ref: HOOKPROC | None = None
        self._hook_handle: int = 0  # HHOOK 值，用于 CallNextHookEx 等
        self._keyboard_hook_handle: int = 0
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._ready_event = threading.Event()
        self._start_error: str | None = None
        self._callback_port: int = 0

        self._middle_held = False
        self._start_x: int = 0
        self._start_y: int = 0
        self._last_y: int = 0
        self._drag_activated = False

        self._DRAG_MIN = 100   # 下滑最小距离才触发
        self._DRAG_MAX = 200   # 超过此距离也不触发
        self._state_lock = threading.Lock()

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    @property
    def running(self) -> bool:
        return self._hook_handle != 0 and not self._stop_event.is_set()

    def start(self, callback_port: int) -> bool:
        if sys.platform != "win32":
            _log("非 win32 平台，跳过")
            return False

        with self._state_lock:
            if self.running:
                _log("钩子已在运行")
                return True
            self._callback_port = callback_port
            self._stop_event.clear()
            self._ready_event.clear()
            self._start_error = None

        try:
            self._callback_ref = HOOKPROC(self._handler)
            self._keyboard_callback_ref = HOOKPROC(self._keyboard_handler)
        except Exception:
            _log(f"创建 HOOKPROC 失败:\n{traceback.format_exc()}")
            return False

        self._thread = threading.Thread(
            target=self._message_loop, daemon=True, name="mouse-hook"
        )
        self._thread.start()

        if not self._ready_event.wait(timeout=3.0):
            _log("钩子线程启动超时")
            return False

        if self._start_error:
            _log(f"钩子启动失败: {self._start_error}")
            return False

        if not self.running:
            _log("钩子启动失败: hook_handle 无效")
            return False

        _log(f"钩子注册成功, hook_handle={self._hook_handle}")
        return True

    def stop(self) -> None:
        _log("停止钩子…")
        with self._state_lock:
            self._stop_event.set()
            self._middle_held = False
            self._drag_activated = False

        if self._thread and self._thread.is_alive() and self._hook_handle:
            try:
                _user32.PostThreadMessageW(
                    wintypes.DWORD(self._thread.ident), 0x0012, 0, 0
                )
            except OSError:
                pass

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        self._callback_ref = None
        self._keyboard_callback_ref = None
        self._hook_handle = 0
        self._keyboard_hook_handle = 0
        _log("钩子已停止")

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------

    def _handler(self, nCode: int, wParam: int, lParam: int) -> int:
        """鼠标钩子回调"""
        if nCode < 0:
            return self._call_next(nCode, wParam, lParam)

        try:
            p = ctypes.cast(lParam, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
        except Exception:
            return self._call_next(nCode, wParam, lParam)

        if wParam == WM_MBUTTONDOWN:
            with self._state_lock:
                self._middle_held = True
                self._start_x = p.pt.x
                self._start_y = p.pt.y
                self._last_y = p.pt.y
                self._drag_activated = False

        elif wParam == WM_MBUTTONUP:
            was_activated = False
            final_delta = 0
            with self._state_lock:
                was_activated = self._drag_activated
                if was_activated:
                    final_delta = self._last_y - self._start_y
                self._middle_held = False
                self._drag_activated = False
            if was_activated:
                # 松开中键时才触发覆盖窗口，直接进入可点击状态
                self._notify_electron("start", delta_y=final_delta, start_x=self._start_x, start_y=self._start_y)

        elif wParam == WM_MOUSEMOVE:
            with self._state_lock:
                if not self._middle_held:
                    return self._call_next(nCode, wParam, lParam)

                current_y = p.pt.y
                delta_y = current_y - self._start_y

                if not self._drag_activated:
                    if self._DRAG_MIN <= delta_y <= self._DRAG_MAX:
                        self._drag_activated = True
                        self._last_y = current_y
                        # 不在此处通知 Electron —— 等到松开中键时再触发
                    elif delta_y > self._DRAG_MAX:
                        # 超过范围上限，放弃本次拖拽（不再触发）
                        self._middle_held = False
                else:
                    if abs(current_y - self._last_y) >= 4:
                        self._last_y = current_y
                        self._notify_electron("move", delta_y=delta_y, start_x=self._start_x, start_y=self._start_y)

        return self._call_next(nCode, wParam, lParam)

    def _keyboard_handler(self, nCode: int, wParam: int, lParam: int) -> int:
        """键盘钩子回调 —— 检测 ESC 按键"""
        if nCode < 0:
            return self._call_next_keyboard(nCode, wParam, lParam)

        if wParam in (WM_KEYDOWN, WM_SYSKEYDOWN):
            try:
                p = ctypes.cast(lParam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            except Exception:
                return self._call_next_keyboard(nCode, wParam, lParam)

            if p.vkCode == VK_ESCAPE:
                _log("ESC 键按下，通知关闭覆盖窗口")
                self._notify_electron("key_esc", delta_y=0, start_x=0, start_y=0)
                # 不吞掉按键，让其他程序也能收到 ESC

        return self._call_next_keyboard(nCode, wParam, lParam)

    def _call_next(self, nCode: int, wParam: int, lParam: int) -> int:
        try:
            return int(_user32.CallNextHookEx(
                wintypes.HHOOK(self._hook_handle), nCode, wParam, lParam
            ))
        except OSError:
            return 0

    def _call_next_keyboard(self, nCode: int, wParam: int, lParam: int) -> int:
        try:
            return int(_user32.CallNextHookEx(
                wintypes.HHOOK(self._keyboard_hook_handle), nCode, wParam, lParam
            ))
        except OSError:
            return 0

    def _notify_electron(self, action: str, delta_y: int = 0, start_x: int = 0, start_y: int = 0) -> None:
        port = self._callback_port
        if not port:
            return
        threading.Thread(
            target=self._do_notify,
            args=(port, action, delta_y, start_x, start_y),
            daemon=True,
            name="mouse-hook-notify",
        ).start()

    @staticmethod
    def _do_notify(port: int, action: str, delta_y: int, start_x: int, start_y: int) -> None:
        try:
            data = json.dumps({
                "action": action,
                "deltaY": delta_y,
                "startX": start_x,
                "startY": start_y,
            }).encode("utf-8")
            req = urllib_request.Request(
                f"http://127.0.0.1:{port}/internal/mouse-hook",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib_request.urlopen(req, timeout=0.5)
        except Exception:
            pass

    def _message_loop(self) -> None:
        """钩子线程入口：注册 WH_MOUSE_LL + WH_KEYBOARD_LL → 进入消息循环"""
        try:
            # WH_MOUSE_LL 的特殊之处：它可以捕获当前进程之外的鼠标事件，
            # 且 hMod 可以传 NULL（0），不需要 DLL 模块句柄。
            # 这是 WH_KEYBOARD_LL / WH_MOUSE_LL 与其他钩子类型的区别。
            hhook = _user32.SetWindowsHookExW(
                WH_MOUSE_LL,
                self._callback_ref,
                0,  # NULL: 低层钩子不需要 DLL 模块句柄
                0,
            )
            if not hhook:
                err = ctypes.get_last_error()
                self._start_error = f"SetWindowsHookExW(WH_MOUSE_LL) 失败, GetLastError={err}"
                _log(self._start_error)
                self._ready_event.set()
                return

            with self._state_lock:
                self._hook_handle = hhook
            _log(f"SetWindowsHookExW(WH_MOUSE_LL) 成功, hook_handle={self._hook_handle}")

            # 注册键盘钩子（检测 ESC 按键）
            keyboard_hhook = _user32.SetWindowsHookExW(
                WH_KEYBOARD_LL,
                self._keyboard_callback_ref,
                0,
                0,
            )
            if not keyboard_hhook:
                err = ctypes.get_last_error()
                _log(f"SetWindowsHookExW(WH_KEYBOARD_LL) 失败, GetLastError={err}，ESC 按键关闭将不可用")
            else:
                with self._state_lock:
                    self._keyboard_hook_handle = keyboard_hhook
                _log(f"SetWindowsHookExW(WH_KEYBOARD_LL) 成功, hook_handle={self._keyboard_hook_handle}")

            self._ready_event.set()

            # 消息循环
            msg = wintypes.MSG()
            while not self._stop_event.is_set():
                ret = _user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if ret in (0, -1):
                    break
                _user32.TranslateMessage(ctypes.byref(msg))
                _user32.DispatchMessageW(ctypes.byref(msg))

            # 退出前卸载钩子
            with self._state_lock:
                if self._keyboard_hook_handle:
                    try:
                        _user32.UnhookWindowsHookEx(wintypes.HHOOK(self._keyboard_hook_handle))
                        _log("键盘钩子已卸载")
                    except OSError:
                        pass
                    self._keyboard_hook_handle = 0
                if self._hook_handle:
                    try:
                        _user32.UnhookWindowsHookEx(wintypes.HHOOK(self._hook_handle))
                        _log("鼠标钩子已卸载")
                    except OSError:
                        pass
                    self._hook_handle = 0

        except Exception:
            self._start_error = f"消息循环异常:\n{traceback.format_exc()}"
            _log(self._start_error)
        finally:
            self._ready_event.set()


_global_mouse_hook = GlobalMouseHook()


def get_mouse_hook() -> GlobalMouseHook:
    return _global_mouse_hook
