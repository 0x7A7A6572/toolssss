"""鼠标钩子域路由"""

from fastapi import APIRouter

from app.domains.mouse_hook.service import get_mouse_hook
from app.models.mouse_hook import MouseHookStartRequest, MouseHookStatusResponse

router = APIRouter()


@router.post("/start", response_model=MouseHookStatusResponse)
async def mouse_hook_start(body: MouseHookStartRequest):
    """启动全局鼠标钩子"""
    hook = get_mouse_hook()
    ok = hook.start(callback_port=body.callback_port)
    return MouseHookStatusResponse(running=ok)


@router.post("/stop", response_model=MouseHookStatusResponse)
async def mouse_hook_stop():
    """停止全局鼠标钩子"""
    hook = get_mouse_hook()
    hook.stop()
    return MouseHookStatusResponse(running=hook.running)


@router.get("/status", response_model=MouseHookStatusResponse)
async def mouse_hook_status():
    """查询钩子运行状态"""
    return MouseHookStatusResponse(running=get_mouse_hook().running)
