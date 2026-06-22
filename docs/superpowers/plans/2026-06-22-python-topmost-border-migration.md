# Python Topmost Border Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Electron polling-based topmost border highlight with a Python Win32 event-driven border manager that follows external windows reliably during move, activate, deactivate, minimize, and close.

**Architecture:** Keep the existing `topmostWindows` ownership in the Electron main process, but stop drawing borders there. Add a Python `topmost border manager` that owns overlay windows and Win32 hooks. Electron sends the desired border state to Python through a single sync-style HTTP API, and Python computes add/update/remove diffs internally. Keep the existing PowerShell/Electron implementation as fallback until the Python path is verified.

**Tech Stack:** Electron main process, Python FastAPI, `ctypes` Win32 API, `System.Windows.Forms` only if absolutely needed, pytest/TestClient, existing app settings and shortcuts.

---

## File Structure

- Modify: `f:\codes\toolssss\src\main\window-stash.ts`
  Stop creating Electron overlay windows for topmost borders. Keep `topmostWindows` as the source of truth and send sync requests to Python whenever the set or border settings change.
- Modify: `f:\codes\toolssss\src\main\domains\external-window\index.ts`
  Add a small HTTP client for Python border sync/clear calls, reusing the existing Python bridge pattern.
- Modify: `f:\codes\toolssss\src\main\index.ts`
  Clear Python-managed borders during shutdown, next to existing topmost cleanup.
- Modify: `f:\codes\toolssss\server\app\models\windows.py`
  Add request/response models for border style and sync payloads.
- Create: `f:\codes\toolssss\server\app\domains\windows\border_manager.py`
  Own the Python-side runtime state: watched windows, overlay windows, WinEvent hooks, UI thread, diffing, sync, clear, and shutdown.
- Modify: `f:\codes\toolssss\server\app\domains\windows\service.py`
  Expose thin service helpers that validate HWNDs and delegate to the border manager.
- Modify: `f:\codes\toolssss\server\app\domains\windows\router.py`
  Add HTTP endpoints for border sync and clear.
- Create: `f:\codes\toolssss\server\tests\test_windows_border_router.py`
  Test router payload validation and delegation.
- Modify: `f:\codes\toolssss\server\tests\conftest.py`
  Only if needed for shared fixtures or cleanup.

## Scope Check

- This plan only migrates the `topmost border highlight` feature.
- It does not migrate `stash handle`, `hideExternalWindowToEdge`, or full external-window PowerShell removal.
- It keeps the current `toggleTopmostWindowAtCursor()` behavior intact and only changes how border rendering is driven.

### Task 1: Define the Python Border Sync API

**Files:**
- Modify: `f:\codes\toolssss\server\app\models\windows.py`
- Modify: `f:\codes\toolssss\server\app\domains\windows\router.py`
- Test: `f:\codes\toolssss\server\tests\test_windows_border_router.py`

- [ ] **Step 1: Write the failing router tests**

```python
from unittest.mock import patch


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
    mocked.assert_called_once_with(enabled=True, color="#3b82f6", width=3, hwnds=["1001", "1002"])


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: FAIL with missing router endpoints or missing imported symbols.

- [ ] **Step 3: Add request/response models**

```python
class TopmostBorderSyncRequest(BaseModel):
    enabled: bool
    color: str = Field(pattern=r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    width: int = Field(ge=1, le=16)
    hwnds: list[str] = Field(default_factory=list)


class TopmostBorderSyncResponse(BaseModel):
    ok: bool
    count: int
```

- [ ] **Step 4: Add the router endpoints**

```python
@router.post("/topmost-borders/sync", response_model=TopmostBorderSyncResponse)
async def topmost_border_sync(body: TopmostBorderSyncRequest):
    count = sync_topmost_borders(
        enabled=body.enabled,
        color=body.color,
        width=body.width,
        hwnds=body.hwnds,
    )
    return TopmostBorderSyncResponse(ok=True, count=count)


@router.post("/topmost-borders/clear", response_model=TopmostBorderSyncResponse)
async def topmost_border_clear():
    count = clear_topmost_borders()
    return TopmostBorderSyncResponse(ok=True, count=count)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/app/models/windows.py server/app/domains/windows/router.py server/tests/test_windows_border_router.py
git commit -m "feat: add python topmost border sync api"
```

### Task 2: Build the Python Border Manager Core

**Files:**
- Create: `f:\codes\toolssss\server\app\domains\windows\border_manager.py`
- Modify: `f:\codes\toolssss\server\app\domains\windows\service.py`
- Test: `f:\codes\toolssss\server\tests\test_windows_border_router.py`

- [ ] **Step 1: Write the first failing unit-style test for service delegation**

```python
from unittest.mock import patch

from app.domains.windows.service import sync_topmost_borders


def test_service_sync_filters_blank_hwnds() -> None:
    with patch("app.domains.windows.service._BORDER_MANAGER.sync", return_value=1) as mocked:
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: FAIL with missing service function or missing manager object.

- [ ] **Step 3: Create the manager skeleton**

```python
class TopmostBorderManager:
    def __init__(self) -> None:
        self._targets: dict[str, BorderTarget] = {}
        self._style = BorderStyle(enabled=True, color="#3b82f6", width=3)

    def sync(self, *, enabled: bool, color: str, width: int, hwnds: list[str]) -> int:
        raise NotImplementedError

    def clear(self) -> int:
        raise NotImplementedError


_BORDER_MANAGER = TopmostBorderManager()
```

- [ ] **Step 4: Add service helpers that normalize HWNDs before delegating**

```python
def sync_topmost_borders(*, enabled: bool, color: str, width: int, hwnds: list[str]) -> int:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in hwnds:
        hwnd = raw.strip()
        if not hwnd or hwnd in seen:
            continue
        seen.add(hwnd)
        normalized.append(hwnd)
    return _BORDER_MANAGER.sync(enabled=enabled, color=color, width=width, hwnds=normalized)


def clear_topmost_borders() -> int:
    return _BORDER_MANAGER.clear()
```

- [ ] **Step 5: Implement the minimum internal data structures in `border_manager.py`**

```python
@dataclass
class BorderStyle:
    enabled: bool
    color: str
    width: int


@dataclass
class BorderTarget:
    hwnd: str
    root_hwnd: int
    overlay: object | None = None


class TopmostBorderManager:
    def __init__(self) -> None:
        self._targets: dict[str, BorderTarget] = {}
        self._style = BorderStyle(enabled=True, color="#3b82f6", width=3)

    def sync(self, *, enabled: bool, color: str, width: int, hwnds: list[str]) -> int:
        self._style = BorderStyle(enabled=enabled, color=color, width=width)
        desired = set(hwnds if enabled else [])
        for hwnd in list(self._targets):
            if hwnd not in desired:
                self._remove_target(hwnd)
        for hwnd in hwnds:
            if hwnd not in self._targets:
                self._targets[hwnd] = BorderTarget(hwnd=hwnd, root_hwnd=int(hwnd))
        return len(self._targets)

    def clear(self) -> int:
        removed = len(self._targets)
        self._targets.clear()
        return removed
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/app/domains/windows/border_manager.py server/app/domains/windows/service.py server/tests/test_windows_border_router.py
git commit -m "feat: add python border manager core"
```

### Task 3: Make the Python Border Manager Event-Driven

**Files:**
- Modify: `f:\codes\toolssss\server\app\domains\windows\border_manager.py`
- Test: `f:\codes\toolssss\server\tests\test_windows_border_router.py`

- [ ] **Step 1: Write a focused test for diffing behavior**

```python
from app.domains.windows.border_manager import TopmostBorderManager


def test_manager_sync_removes_missing_hwnds() -> None:
    manager = TopmostBorderManager()
    manager._targets = {
        "1001": object(),
        "1002": object(),
    }

    manager.sync(enabled=True, color="#3b82f6", width=3, hwnds=["1002", "1003"])

    assert sorted(manager._targets.keys()) == ["1002", "1003"]
```

- [ ] **Step 2: Run test to verify it fails if the manager still uses placeholders**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: FAIL until diff logic and concrete state transitions exist.

- [ ] **Step 3: Replace placeholder targets with real overlay and root-window state**

```python
@dataclass
class BorderTarget:
    hwnd: str
    root_hwnd: int
    overlay_hwnd: int
    visible: bool
    rect: tuple[int, int, int, int] | None
```

- [ ] **Step 4: Implement Win32 helper functions**

```python
def _get_root_hwnd(hwnd: int) -> int: ...
def _get_window_rect(hwnd: int) -> tuple[int, int, int, int] | None: ...
def _is_window_visible(hwnd: int) -> bool: ...
def _is_window_minimized(hwnd: int) -> bool: ...
def _create_overlay_window(color: str, width: int) -> int: ...
def _set_overlay_bounds(overlay_hwnd: int, rect: tuple[int, int, int, int]) -> None: ...
def _show_overlay(overlay_hwnd: int) -> None: ...
def _hide_overlay(overlay_hwnd: int) -> None: ...
def _destroy_overlay(overlay_hwnd: int) -> None: ...
```

- [ ] **Step 5: Implement a single UI thread + WinEvent hook loop**

```python
def _ensure_runtime(self) -> None:
    if self._runtime_started:
        return
    self._runtime_started = True
    self._start_ui_thread()
    self._install_hooks()


def _install_hooks(self) -> None:
    self._hook_location = user32.SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, ...)
    self._hook_foreground = user32.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, ...)
    self._hook_hide = user32.SetWinEventHook(EVENT_OBJECT_HIDE, EVENT_OBJECT_HIDE, ...)
    self._hook_destroy = user32.SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY, ...)
```

- [ ] **Step 6: On every relevant event, refresh only the affected overlay**

```python
def _handle_win_event(self, hwnd: int, event_type: int) -> None:
    root = _get_root_hwnd(hwnd)
    for target in self._targets.values():
        if target.root_hwnd != root:
            continue
        self._refresh_target(target, force_raise=event_type == EVENT_SYSTEM_FOREGROUND)
        break
```

- [ ] **Step 7: Add a low-frequency watchdog instead of the current 90ms polling**

```python
def _start_watchdog(self) -> None:
    # Reconcile once per second in case the WinEvent hook misses a transition.
    self._watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/app/domains/windows/border_manager.py server/tests/test_windows_border_router.py
git commit -m "feat: add event-driven python topmost border manager"
```

### Task 4: Replace Electron Overlay Drawing With Python Sync

**Files:**
- Modify: `f:\codes\toolssss\src\main\window-stash.ts`
- Modify: `f:\codes\toolssss\src\main\domains\external-window\index.ts`

- [ ] **Step 1: Write the failing TypeScript call shape check**

```typescript
// Pseudo-test shape for manual verification:
// 1. toggleTopmostWindowAtCursor() adds hwnd into topmostWindows
// 2. syncTopmostBorderState() POSTs current hwnd set + style to Python
// 3. No BrowserWindow overlay gets created for topmost borders
```

- [ ] **Step 2: Remove Electron overlay-only state from `window-stash.ts`**

```typescript
// Delete these:
const topmostOverlays = new Map<string, BrowserWindow>()
let topmostOverlayTimer: NodeJS.Timeout | null = null
let topmostOverlaySyncBusy = false
const topmostLastRects = new Map<string, ExternalWindowRect>()
const topmostDragChangedAt = new Map<string, number>()
```

- [ ] **Step 3: Add a single Python sync call helper in `external-window/index.ts`**

```typescript
export async function syncPythonTopmostBorders(payload: {
  enabled: boolean
  color: string
  width: number
  hwnds: string[]
}): Promise<boolean> {
  const res = await postPythonWindows<{ ok?: unknown; count?: unknown }>(
    '/api/windows/topmost-borders/sync',
    payload
  )
  return Boolean(res && res.ok)
}

export async function clearPythonTopmostBorders(): Promise<boolean> {
  const res = await postPythonWindows<{ ok?: unknown; count?: unknown }>(
    '/api/windows/topmost-borders/clear',
    {}
  )
  return Boolean(res && res.ok)
}
```

- [ ] **Step 4: Add a single sync function in `window-stash.ts`**

```typescript
async function syncTopmostBorderState(): Promise<void> {
  const cfg = getTopmostBorderSettings()
  const hwnds = cfg.enabled ? Array.from(topmostWindows.values()) : []
  const ok = await syncPythonTopmostBorders({
    enabled: cfg.enabled,
    color: cfg.color,
    width: cfg.width,
    hwnds
  })
  if (ok) return
  // Temporary fallback path while Python rollout is stabilizing.
  for (const hwnd of hwnds) syncTopmostBorder(hwnd, true)
}
```

- [ ] **Step 5: Replace direct overlay management calls**

```typescript
// In toggleTopmostWindowAtCursor():
if (nextTopmost) topmostWindows.add(hwnd)
else topmostWindows.delete(hwnd)
await syncTopmostBorderState()

// In applyTopmostWindowSettingsToRuntime():
void syncTopmostBorderState()

// In clearAllTopmostWindows():
await clearPythonTopmostBorders()
```

- [ ] **Step 6: Keep the old overlay code only behind temporary fallback helpers**

```typescript
// Rename current overlay methods to fallback-only helpers and mark them for deletion:
function syncTopmostBorderFallback(hwnd: string, topmost: boolean): void { ... }
function stopTopmostOverlayFallbackAndCloseAll(): void { ... }
```

- [ ] **Step 7: Run app-level verification**

Run: `pnpm test -- --runInBand` or the smallest existing command that checks TypeScript integrity  
Expected: existing tests pass, no TS diagnostics in edited files

- [ ] **Step 8: Commit**

```bash
git add src/main/window-stash.ts src/main/domains/external-window/index.ts
git commit -m "feat: drive topmost borders through python sync"
```

### Task 5: Wire Shutdown and Recovery Correctly

**Files:**
- Modify: `f:\codes\toolssss\src\main\index.ts`
- Modify: `f:\codes\toolssss\server\app\domains\windows\border_manager.py`

- [ ] **Step 1: Add a failing manual scenario checklist**

```text
Scenario:
1. Mark two external windows as topmost.
2. Quit the app.
3. Python border overlays disappear before process exit.
4. Reopen the app.
5. No orphan border overlays remain on screen.
```

- [ ] **Step 2: Add explicit clear during Electron shutdown**

```typescript
app.on('will-quit', (e) => {
  // before stopPythonServer()
  clearPythonTopmostBorders().catch(() => null)
})
```

- [ ] **Step 3: Add Python-side cleanup hooks**

```python
def shutdown(self) -> None:
    self.clear()
    self._uninstall_hooks()
    self._stop_ui_thread()
```

- [ ] **Step 4: Make `clear()` idempotent**

```python
def clear(self) -> int:
    removed = len(self._targets)
    for hwnd in list(self._targets):
        self._remove_target(hwnd)
    self._targets.clear()
    return removed
```

- [ ] **Step 5: Run manual verification**

Run: launch app, toggle topmost on/off repeatedly, quit app, reopen app  
Expected: no orphan overlay, no duplicate overlay, no crash on exit

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts server/app/domains/windows/border_manager.py
git commit -m "fix: clean python topmost borders on shutdown"
```

### Task 6: Remove the Polling-Based Border Path After Verification

**Files:**
- Modify: `f:\codes\toolssss\src\main\window-stash.ts`
- Modify: `f:\codes\toolssss\src\libs\win32\powershellRunners.ts`

- [ ] **Step 1: Verify Python path is the primary path in real usage**

```text
Manual checks:
- drag external window slowly and quickly
- alt-tab between windows
- minimize / restore target window
- close target window while highlighted
- enable / disable topmost highlight in settings
```

- [ ] **Step 2: Delete the Electron polling overlay code**

```typescript
// Remove:
topmostOverlayHtml()
ensureTopmostOverlayWindow()
applyTopmostOverlayStyle()
ensureTopmostOverlayTimer()
syncAllTopmostOverlays()
removeTopmostOverlay()
stopTopmostOverlayTimerIfIdle()
stopTopmostOverlayTimerAndCloseAll()
syncTopmostBorder()
```

- [ ] **Step 3: Decide whether the old PowerShell pinned-border runner is still needed**

```text
If no remaining feature calls PINNED_BORDER_RUNNER_PS:
- remove exports
- remove unused C# payload
- delete bridge startup code
Otherwise:
- keep it only for stash-border or legacy paths, but document why
```

- [ ] **Step 4: Run diagnostics and targeted tests**

Run: `python -m pytest server/tests/test_windows_border_router.py -v`  
Run: TypeScript diagnostics for `src/main/window-stash.ts` and `src/main/domains/external-window/index.ts`  
Expected: PASS and zero diagnostics

- [ ] **Step 5: Commit**

```bash
git add src/main/window-stash.ts src/libs/win32/powershellRunners.ts
git commit -m "refactor: remove polling topmost border implementation"
```

## Manual Verification Matrix

- Toggle one external window topmost: border appears immediately.
- Drag the target window continuously: border follows without hide/show flicker.
- Activate another window: highlighted border stays attached to its own window and keeps correct Z-order.
- Minimize target window: border hides.
- Restore target window: border reappears at the correct bounds.
- Close target window: border is removed automatically.
- Change border color/width in `WindowStash` settings: border style updates without retoggling topmost.
- Disable highlight globally: all borders disappear, topmost state remains unchanged.
- Quit the app while borders are visible: no orphan overlays remain.

## Self-Review

- Spec coverage: this plan directly addresses the real complaint, which is poor follow behavior during move, activate, and blur. It replaces the current polling overlay path with a Python event-driven manager and includes shutdown safety plus fallback.
- Placeholder scan: no `TODO`, `TBD`, or vague “write tests later” steps remain.
- Type consistency: the plan uses one consistent API shape for border sync: `enabled`, `color`, `width`, `hwnds`, with `TopmostBorderSyncResponse { ok, count }`.

Plan complete and saved to `docs/superpowers/plans/2026-06-22-python-topmost-border-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
