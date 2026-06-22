# Snip Paste Python Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `截屏贴图` feature to a dedicated Python desktop worker without breaking the current Electron user flow, shortcuts, settings, or fallback behavior.

**Architecture:** Keep Electron as the shell and source of truth for settings, preload, tray, and shortcut registration. Move screenshot overlay UI, image save/stick flow, gallery file operations, sticker windows, and OCR into a separate Python GUI worker process driven by line-delimited JSON over `stdio`; do not cram Qt into the existing FastAPI service process because that is how you create event-loop garbage and random hangs.

**Tech Stack:** Electron, TypeScript, PySide6, Pillow, RapidOCR ONNX Runtime, pytest

---

## File Map

- Modify: `f:\codes\toolssss\src\shared\settings.ts`
  Responsibility: add a real provider switch for the snip/sticker pipeline.
- Modify: `f:\codes\toolssss\src\renderer\src\views\Settings\SettingsView.vue`
  Responsibility: expose provider choice and keep current save-dir UX unchanged.
- Create: `f:\codes\toolssss\src\main\core\python-desktop-worker.ts`
  Responsibility: spawn the Python GUI worker, send commands, receive events, and restart safely.
- Modify: `f:\codes\toolssss\src\main\index.ts`
  Responsibility: bootstrap the worker and inject it into `snip` and `stickers` domains.
- Modify: `f:\codes\toolssss\src\main\domains\snip\index.ts`
  Responsibility: route capture and gallery operations to Python when provider is `python`, otherwise keep Electron path.
- Modify: `f:\codes\toolssss\src\main\domains\stickers\index.ts`
  Responsibility: route sticker open/close/toggle/OCR to Python when provider is `python`, otherwise keep Electron path.
- Modify: `f:\codes\toolssss\server\pyproject.toml`
  Responsibility: declare Python desktop-worker dependencies.
- Create: `f:\codes\toolssss\server\desktop_worker\__init__.py`
  Responsibility: package marker.
- Create: `f:\codes\toolssss\server\desktop_worker\protocol.py`
  Responsibility: typed command/event payloads and JSON helpers.
- Create: `f:\codes\toolssss\server\desktop_worker\main.py`
  Responsibility: process entrypoint and `QApplication` bootstrap.
- Create: `f:\codes\toolssss\server\desktop_worker\app_controller.py`
  Responsibility: command dispatch and shared runtime state.
- Create: `f:\codes\toolssss\server\desktop_worker\services\capture_service.py`
  Responsibility: screenshot capture, crop, annotation export, clipboard copy, and gallery save.
- Create: `f:\codes\toolssss\server\desktop_worker\services\gallery_service.py`
  Responsibility: list, thumbnail, clear, reveal, and stick saved images.
- Create: `f:\codes\toolssss\server\desktop_worker\services\ocr_service.py`
  Responsibility: offline OCR for sticker images.
- Create: `f:\codes\toolssss\server\desktop_worker\windows\capture_overlay.py`
  Responsibility: full-screen selection and annotation overlay.
- Create: `f:\codes\toolssss\server\desktop_worker\windows\sticker_window.py`
  Responsibility: always-on-top sticker window, drag/resize/opacity/rotation/flip/OCR overlay.
- Create: `f:\codes\toolssss\server\tests\desktop_worker\test_protocol.py`
  Responsibility: protocol normalization tests.
- Create: `f:\codes\toolssss\server\tests\desktop_worker\test_gallery_service.py`
  Responsibility: gallery list/clear/path guard tests.
- Create: `f:\codes\toolssss\server\tests\desktop_worker\test_ocr_service.py`
  Responsibility: OCR result normalization tests.

## Current Migration Scope

The current `截屏贴图` feature is not one thing. It is this chain:

1. Electron global shortcut starts capture.
2. Main process suspends eye overlay and creates a capture window.
3. Capture UI provides selection, annotation, color picking, auto-snap, save, save-and-stick.
4. Result is copied to clipboard and optionally saved to the configured screenshots directory.
5. Saved files are listed, thumbnailed, revealed, cleared, and re-opened as stickers.
6. Sticker windows are always-on-top, draggable, resizable, scalable, rotatable, flippable.
7. Sticker image OCR runs offline and can copy recognized text.

Do not pretend this is "just screenshot". It is a desktop runtime subsystem.

## Tech Choice

Use this stack for the Python side:

- `PySide6`
  Reason: one dependency covers windowing, always-on-top windows, clipboard, painting, keyboard/mouse events, and image conversion. This removes a pile of special cases.
- `Pillow`
  Reason: stable image encode/decode, resize, and thumbnail generation.
- `rapidocr_onnxruntime`
  Reason: offline OCR with Chinese/English support and no system Tesseract install requirement.
- `stdio` line-delimited JSON protocol between Electron and Python
  Reason: this is a local child process, not a web service. Do not waste time with HTTP ports, health routes, and GUI-process web servers.

Do **not** put this into the existing `FastAPI` process. Qt event loop plus HTTP server plus long-lived desktop windows in one process is a bad design and will rot.

### Task 1: Freeze The Boundary

**Files:**
- Modify: `f:\codes\toolssss\src\shared\settings.ts`
- Modify: `f:\codes\toolssss\src\renderer\src\views\Settings\SettingsView.vue`

- [ ] **Step 1: Make the provider switch explicit**

```ts
export interface AppSettings {
  snip: {
    provider: 'electron' | 'python'
    saveDir: string
    suspendEyeOverlay: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  snip: {
    provider: 'electron',
    saveDir: '',
    suspendEyeOverlay: false
  }
}
```

- [ ] **Step 2: Add a settings UI switch and keep save-dir behavior unchanged**

```vue
<div class="row">
  <div class="label">截屏引擎</div>
  <a-segmented
    :value="settings.snip.provider"
    :options="[
      { label: 'Electron', value: 'electron' },
      { label: 'Python', value: 'python' }
    ]"
    @change="update({ snip: { provider: $event as 'electron' | 'python' } })"
  />
</div>
```

- [ ] **Step 3: Keep fallback as a hard rule**

```text
If provider === "python" but the worker fails to start, route back to Electron automatically.
Never block F1/F3/Shift+F3 just because Python is missing.
```

### Task 2: Add The Electron Worker Manager

**Files:**
- Create: `f:\codes\toolssss\src\main\core\python-desktop-worker.ts`
- Modify: `f:\codes\toolssss\src\main\index.ts`

- [ ] **Step 1: Create one manager with one job**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'

export type DesktopWorkerEvent =
  | { type: 'capture_saved'; filePath: string; copied: boolean; stickAfterSave: boolean }
  | { type: 'gallery_changed' }
  | { type: 'error'; message: string }

export type DesktopWorkerCommand =
  | { id: string; type: 'start_capture'; saveDir: string; stickAfterSave?: boolean }
  | { id: string; type: 'paste_sticker_from_clipboard' }
  | { id: string; type: 'toggle_stickers_hidden' }
  | { id: string; type: 'list_saved'; saveDir: string }
  | { id: string; type: 'thumb_saved'; filePath: string }
  | { id: string; type: 'clear_saved'; saveDir: string }
  | { id: string; type: 'reveal_saved'; filePath: string }
  | { id: string; type: 'stick_saved'; filePath: string }
  | { id: string; type: 'ocr_sticker'; dataUrl: string }
```

- [ ] **Step 2: Spawn the worker as a dedicated process**

```ts
const proc = spawn(pythonCmd, ['-m', 'desktop_worker.main'], {
  cwd: join(__dirname, '../../server'),
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONUNBUFFERED: '1' }
})
```

- [ ] **Step 3: Parse `stdout` as newline-delimited JSON**

```ts
let buffer = ''
proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8')
  for (;;) {
    const idx = buffer.indexOf('\n')
    if (idx < 0) break
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    onMessage(JSON.parse(line) as DesktopWorkerEvent)
  }
})
```

- [ ] **Step 4: Wire the manager into `index.ts` without touching shortcut behavior**

```ts
const desktopWorker = createPythonDesktopWorker({
  getSnipProvider: () => settings.snip.provider,
  getSnipSaveDir: () => settings.snip.saveDir
})

app.whenReady().then(async () => {
  await desktopWorker.start().catch(() => null)
})
```

### Task 3: Bootstrap The Python GUI Process

**Files:**
- Modify: `f:\codes\toolssss\server\pyproject.toml`
- Create: `f:\codes\toolssss\server\desktop_worker\main.py`
- Create: `f:\codes\toolssss\server\desktop_worker\protocol.py`
- Create: `f:\codes\toolssss\server\desktop_worker\app_controller.py`

- [ ] **Step 1: Add only the dependencies the desktop worker actually needs**

```toml
[project]
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "pydantic>=2.0",
  "httpx>=0.27.0",
  "langchain>=0.3.0",
  "langchain-openai>=0.2.0",
  "langchain-text-splitters>=0.3.0",
  "sse-starlette>=2.0",
  "PySide6>=6.8.0",
  "Pillow>=11.0.0",
  "rapidocr_onnxruntime>=1.4.0",
]
```

- [ ] **Step 2: Define one protocol module that normalizes all payloads**

```python
from pydantic import BaseModel
from typing import Literal

class StartCaptureCommand(BaseModel):
    id: str
    type: Literal["start_capture"]
    saveDir: str
    stickAfterSave: bool = False

class GalleryChangedEvent(BaseModel):
    type: Literal["gallery_changed"] = "gallery_changed"
```

- [ ] **Step 3: Start `QApplication` once and dispatch commands on the GUI thread**

```python
import json
import sys
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from desktop_worker.app_controller import AppController

def main() -> int:
    app = QApplication(sys.argv)
    controller = AppController()

    def pump() -> None:
        line = sys.stdin.readline()
        if not line:
            app.quit()
            return
        payload = json.loads(line)
        controller.handle_message(payload)
        QTimer.singleShot(0, pump)

    QTimer.singleShot(0, pump)
    return app.exec()
```

- [ ] **Step 4: Emit JSON lines back to Electron**

```python
def send_event(self, payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
```

### Task 4: Implement Screenshot Capture And Export

**Files:**
- Create: `f:\codes\toolssss\server\desktop_worker\services\capture_service.py`
- Create: `f:\codes\toolssss\server\desktop_worker\windows\capture_overlay.py`

- [ ] **Step 1: Capture the screen through Qt, not through extra random dependencies**

```python
from PySide6.QtGui import QGuiApplication

def grab_primary_screen_png() -> bytes:
    screen = QGuiApplication.primaryScreen()
    if screen is None:
        raise RuntimeError("no primary screen")
    pixmap = screen.grabWindow(0)
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    pixmap.save(buffer, "PNG")
    return bytes(buffer.data())
```

- [ ] **Step 2: Build one overlay window that owns selection and annotations**

```python
class CaptureOverlay(QWidget):
    capture_saved = Signal(str, bool, bool)
    capture_canceled = Signal()

    def __init__(self, save_dir: str, stick_after_save: bool) -> None:
        super().__init__(None, Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self._save_dir = save_dir
        self._stick_after_save = stick_after_save
        self.setWindowState(Qt.WindowState.WindowFullScreen)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
```

- [ ] **Step 3: Save to disk with the same timestamp naming rule**

```python
def format_snip_name(ts: datetime) -> str:
    return ts.strftime("%Y%m%d%H%M%S%f")[:-3] + ".png"
```

- [ ] **Step 4: Copy exported image to clipboard before announcing success**

```python
clipboard = QGuiApplication.clipboard()
clipboard.setImage(image)
self.capture_saved.emit(file_path, True, self._stick_after_save)
```

### Task 5: Implement Gallery Operations In Python

**Files:**
- Create: `f:\codes\toolssss\server\desktop_worker\services\gallery_service.py`
- Modify: `f:\codes\toolssss\server\desktop_worker\app_controller.py`
- Modify: `f:\codes\toolssss\src\main\domains\snip\index.ts`

- [ ] **Step 1: Keep gallery path guards in one service**

```python
def is_within(base_dir: Path, file_path: Path) -> bool:
    try:
        file_path.resolve().relative_to(base_dir.resolve())
        return True
    except ValueError:
        return False
```

- [ ] **Step 2: Match the existing gallery payload shape**

```python
def list_saved(save_dir: Path) -> list[dict]:
    rows = []
    for item in save_dir.iterdir():
        if item.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        st = item.stat()
        rows.append({
            "name": item.name,
            "filePath": str(item),
            "thumbUrl": None,
            "mtimeMs": int(st.st_mtime * 1000),
            "size": st.st_size,
        })
    rows.sort(key=lambda row: row["mtimeMs"], reverse=True)
    return rows[:120]
```

- [ ] **Step 3: Route `snip:saved:*` IPC handlers through the provider gate**

```ts
if (deps.getSnipProvider() === 'python' && deps.desktopWorker.isReady()) {
  return await deps.desktopWorker.request({ type: 'list_saved', saveDir: resolveSnipSaveDir() })
}
```

- [ ] **Step 4: Keep Electron fallback unchanged**

```text
Do not delete the current `snip:saved:list`, `thumb`, `clear`, `reveal`, `stick` implementation.
Only branch early to Python and return to the old code when Python is unavailable.
```

### Task 6: Implement Sticker Windows In Python

**Files:**
- Create: `f:\codes\toolssss\server\desktop_worker\windows\sticker_window.py`
- Modify: `f:\codes\toolssss\server\desktop_worker\app_controller.py`
- Modify: `f:\codes\toolssss\src\main\domains\stickers\index.ts`

- [ ] **Step 1: Build one sticker window class for image payloads first**

```python
class StickerWindow(QWidget):
    closed_with_id = Signal(int)

    def __init__(self, sticker_id: int, image: QImage) -> None:
        super().__init__(None, Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self._sticker_id = sticker_id
        self._image = image
        self._scale = 1.0
        self._rotation = 0
        self._flip_x = False
        self._flip_y = False
        self._opacity = 1.0
```

- [ ] **Step 2: Preserve the visible user controls**

```text
Wheel: scale
Ctrl+Wheel: opacity
1 / 2: rotate
3 / 4: flip
Esc / double click: close
```

- [ ] **Step 3: Route paste/open/toggle requests to Python**

```ts
const pasteFromClipboard = async (): Promise<void> => {
  if (deps.getSnipProvider() === 'python' && deps.desktopWorker.isReady()) {
    await deps.desktopWorker.request({ type: 'paste_sticker_from_clipboard' })
    return
  }
  const payload = readClipboardAsStickerPayload()
  if (!payload) return
  stickersHidden = false
  createStickerWindow(deps, payload)
}
```

- [ ] **Step 4: Keep OCR context-menu wiring provider-aware**

```ts
if (deps.getSnipProvider() === 'python' && deps.desktopWorker.isReady()) {
  return await deps.desktopWorker.request({ type: 'ocr_sticker', dataUrl })
}
return await recognizeStickerImageText(dataUrl)
```

### Task 7: Move OCR To Python

**Files:**
- Create: `f:\codes\toolssss\server\desktop_worker\services\ocr_service.py`
- Modify: `f:\codes\toolssss\src\main\domains\stickers\index.ts`

- [ ] **Step 1: Replace in-process Tesseract with one dedicated OCR service**

```python
from rapidocr_onnxruntime import RapidOCR

class OcrService:
    def __init__(self) -> None:
        self._engine = RapidOCR()

    def recognize(self, image_path: str) -> dict:
        result, _ = self._engine(image_path)
        lines = []
        text_parts = []
        for box, text, score in result or []:
            text = (text or "").strip()
            if not text:
                continue
            text_parts.append(text)
            xs = [pt[0] for pt in box]
            ys = [pt[1] for pt in box]
            lines.append({
                "text": text,
                "confidence": float(score or 0),
                "bbox": {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)},
            })
        return {"text": "\n".join(text_parts), "lines": lines}
```

- [ ] **Step 2: Normalize OCR result to the current renderer contract**

```python
return {
    "width": width,
    "height": height,
    "text": payload["text"],
    "lines": payload["lines"],
}
```

- [ ] **Step 3: Remove duplicate OCR caches only after Python OCR is proven stable**

```text
Do not delete the existing Electron/Tesseract OCR path in the same commit as the Python OCR introduction.
First ship provider switch + Python path.
Then remove dead code after parity is verified.
```

### Task 8: Wire Domain Routing Without Breaking Userspace

**Files:**
- Modify: `f:\codes\toolssss\src\main\index.ts`
- Modify: `f:\codes\toolssss\src\main\domains\snip\index.ts`
- Modify: `f:\codes\toolssss\src\main\domains\stickers\index.ts`

- [ ] **Step 1: Inject provider and worker dependencies into both domains**

```ts
const snip = createSnipDomain({
  getMainWindow: () => mainWindow,
  getSnipProvider: () => settings.snip.provider,
  getSnipSaveDirSetting: () => settings.snip.saveDir,
  desktopWorker,
  setCapturing: setSnipCapturing,
  suspendOverlayForSnip: () => overlay.suspendForSnip(),
  resumeOverlayAfterSnip: () => overlay.resumeAfterSnip(),
  stickFromClipboard: () => stickers.pasteFromClipboard(),
  openStickerFromImageDataUrl: (dataUrl) => stickers.openImageDataUrl(dataUrl)
})
```

- [ ] **Step 2: Route capture start through the provider gate**

```ts
const startCapture = (): void => {
  if (deps.getSnipProvider() === 'python' && deps.desktopWorker.isReady()) {
    deps.suspendOverlayForSnip()
    deps.setCapturing(true)
    void deps.desktopWorker
      .request({ type: 'start_capture', saveDir: resolveSnipSaveDir() })
      .finally(() => {
        deps.setCapturing(false)
        deps.resumeOverlayAfterSnip()
      })
    return
  }
  hookScreenshotsOnce()
  deps.suspendOverlayForSnip()
  deps.setCapturing(true)
  void ensureScreenshots().startCapture()
}
```

- [ ] **Step 3: Convert worker events back into existing renderer notifications**

```ts
desktopWorker.onEvent((event) => {
  if (event.type === 'gallery_changed') broadcastSnipSavedChanged()
  if (event.type === 'capture_saved' && event.stickAfterSave) {
    stickers.openImageDataUrl(`file://${event.filePath}`)
  }
})
```

- [ ] **Step 4: Keep current route names, shortcuts, and saved-file naming**

```text
No route change.
No shortcut rename.
No settings key rename beyond `snip.provider`.
No gallery file naming change.
```

### Task 9: Verify Before Deleting Anything

**Files:**
- Test: `f:\codes\toolssss\server\tests\desktop_worker\test_protocol.py`
- Test: `f:\codes\toolssss\server\tests\desktop_worker\test_gallery_service.py`
- Test: `f:\codes\toolssss\server\tests\desktop_worker\test_ocr_service.py`
- Test: `f:\codes\toolssss\src\renderer\src\screenshots\__tests__\ScreenshotsApp.click.test.ts`

- [ ] **Step 1: Add protocol tests**

```python
def test_start_capture_command_accepts_python_provider_shape():
    cmd = StartCaptureCommand.model_validate({
        "id": "1",
        "type": "start_capture",
        "saveDir": "C:/tmp/snips",
        "stickAfterSave": True,
    })
    assert cmd.type == "start_capture"
    assert cmd.stickAfterSave is True
```

- [ ] **Step 2: Add gallery safety tests**

```python
def test_is_within_rejects_parent_escape(tmp_path):
    base = tmp_path / "shots"
    base.mkdir()
    target = tmp_path / "evil.png"
    target.write_bytes(b"x")
    assert is_within(base, target) is False
```

- [ ] **Step 3: Add OCR normalization tests**

```python
def test_normalize_ocr_lines_keeps_bbox_order():
    payload = normalize_ocr_result(
        width=200,
        height=100,
        rows=[([[10, 20], [60, 20], [60, 40], [10, 40]], "hello", 0.98)],
    )
    assert payload["lines"][0]["bbox"] == {"x0": 10, "y0": 20, "x1": 60, "y1": 40}
```

- [ ] **Step 4: Run targeted validation**

```bash
pnpm exec vue-tsc --noEmit -p tsconfig.web.json --composite false
```

Expected: `0 errors`

- [ ] **Step 5: Run Python tests**

```bash
python -m pytest server/tests/desktop_worker -q
```

Expected: all tests pass

- [ ] **Step 6: Manual smoke checks**

```text
1. Provider = Electron: F1/F3/Shift+F3 behave exactly as before.
2. Provider = Python and worker available: capture, save, save-and-stick, gallery, sticker, OCR all work.
3. Provider = Python and worker missing: app logs the failure and falls back to Electron instead of going dead.
```

## Self Review

- Spec coverage: capture, save, save-and-stick, gallery, sticker window, OCR, provider switch, and fallback are all mapped to explicit tasks.
- Placeholder scan: no `TODO`, `TBD`, or hand-wavy "handle edge cases" garbage remains.
- Type consistency: provider name is `electron | python`, worker commands use one `type` field, and gallery payloads stay camelCase to match the renderer.

## Decision

This is worth doing **only as a staged migration**.

Full rewrite in one shot: bad idea.

Separate Python desktop worker with Electron fallback: good idea.

Plan complete and saved to `docs/superpowers/plans/2026-06-22-snip-paste-python-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
