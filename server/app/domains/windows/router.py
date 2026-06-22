"""Windows 窗口能力路由"""

from fastapi import APIRouter

from app.domains.windows.service import (
    activate_window,
    clear_topmost_borders,
    find_windows_by_title,
    get_foreground_window,
    get_window_rect,
    get_window_from_point,
    get_window_root,
    hide_window_to_edge,
    raise_window,
    restore_window,
    set_window_topmost,
    sync_topmost_borders,
)
from app.models.windows import (
    TopmostBorderSyncRequest,
    TopmostBorderSyncResponse,
    WindowFindRequest,
    WindowForegroundRequest,
    WindowHandleRequest,
    WindowHandleResponse,
    WindowFromPointRequest,
    WindowHideEdgeRequest,
    WindowHideEdgeResponse,
    WindowInfoResponse,
    WindowRectResponse,
    WindowRestoreRequest,
    WindowRestoreResponse,
    WindowTopmostRequest,
    WindowTopmostResponse,
)

router = APIRouter()


@router.post("/from-point", response_model=WindowInfoResponse | None)
async def window_from_point(body: WindowFromPointRequest):
    """按屏幕坐标获取窗口"""

    return get_window_from_point(body.x, body.y, body.node_pid)


@router.post("/topmost", response_model=WindowTopmostResponse)
async def window_topmost(body: WindowTopmostRequest):
    """设置窗口置顶状态"""

    return WindowTopmostResponse(ok=set_window_topmost(body.hwnd, body.topmost))


@router.post("/root", response_model=WindowHandleResponse | None)
async def window_root(body: WindowHandleRequest):
    """获取窗口 root hwnd"""

    return get_window_root(body.hwnd)


@router.post("/foreground", response_model=WindowInfoResponse | None)
async def window_foreground(body: WindowForegroundRequest):
    """获取当前前台窗口"""

    return get_foreground_window(body.node_pid)


@router.post("/rect", response_model=WindowRectResponse | None)
async def window_rect(body: WindowHandleRequest):
    """获取窗口矩形"""

    return get_window_rect(body.hwnd)


@router.post("/raise", response_model=WindowTopmostResponse)
async def window_raise(body: WindowHandleRequest):
    """将窗口抬到前台可见层级"""

    return WindowTopmostResponse(ok=raise_window(body.hwnd))


@router.post("/activate", response_model=WindowTopmostResponse)
async def window_activate(body: WindowHandleRequest):
    """激活（设为前台）外部窗口"""

    return WindowTopmostResponse(ok=activate_window(body.hwnd))


@router.post("/find", response_model=list[WindowInfoResponse])
async def window_find(body: WindowFindRequest):
    """按标题搜索外部窗口"""

    return find_windows_by_title(title=body.title, match=body.match, limit=body.limit)


@router.post("/hide-edge", response_model=WindowHideEdgeResponse)
async def window_hide_edge(body: WindowHideEdgeRequest):
    """将窗口隐藏到屏幕边缘"""

    result = hide_window_to_edge(
        hwnd=body.hwnd,
        edge=body.edge,
        peek_px=body.peek_px,
        animate=body.animate,
        duration_ms=body.duration_ms,
    )
    return WindowHideEdgeResponse(
        ok=result["ok"],
        hwnd=result["hwnd"],
        rect=result.get("rect"),
        new_pos=result.get("new_pos"),
    )


@router.post("/restore", response_model=WindowRestoreResponse)
async def window_restore(body: WindowRestoreRequest):
    """将窗口恢复到指定位置"""

    result = restore_window(
        hwnd=body.hwnd,
        target_rect=body.rect.model_dump(),
        animate=body.animate,
        duration_ms=body.duration_ms,
    )
    return WindowRestoreResponse(
        ok=result["ok"],
        hwnd=result["hwnd"],
    )


@router.post("/topmost-borders/sync", response_model=TopmostBorderSyncResponse)
async def topmost_border_sync(body: TopmostBorderSyncRequest):
    """同步置顶边框目标集合"""

    count = sync_topmost_borders(
        enabled=body.enabled,
        color=body.color,
        width=body.width,
        hwnds=body.hwnds,
    )
    return TopmostBorderSyncResponse(ok=True, count=count)


@router.post("/topmost-borders/clear", response_model=TopmostBorderSyncResponse)
async def topmost_border_clear():
    """清空置顶边框目标集合"""

    count = clear_topmost_borders()
    return TopmostBorderSyncResponse(ok=True, count=count)
