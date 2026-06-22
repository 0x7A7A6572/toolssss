"""Windows 域请求/响应模型"""

from pydantic import BaseModel, Field


class WindowFromPointRequest(BaseModel):
    """按屏幕坐标查找窗口"""

    x: int
    y: int
    node_pid: int = Field(default=0, alias="nodePid")


class WindowForegroundRequest(BaseModel):
    """前台窗口查询请求"""

    node_pid: int = Field(default=0, alias="nodePid")


class WindowHandleRequest(BaseModel):
    """单个窗口句柄请求"""

    hwnd: str = Field(min_length=1)


class WindowTopmostRequest(BaseModel):
    """窗口置顶切换请求"""

    hwnd: str = Field(min_length=1)
    topmost: bool


class WindowTopmostResponse(BaseModel):
    """窗口置顶切换结果"""

    ok: bool


class TopmostBorderSyncRequest(BaseModel):
    """置顶边框同步请求"""

    enabled: bool
    color: str = Field(pattern=r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    width: int = Field(ge=1, le=16)
    hwnds: list[str] = Field(default_factory=list)


class TopmostBorderSyncResponse(BaseModel):
    """置顶边框同步结果"""

    ok: bool
    count: int


class WindowInfoResponse(BaseModel):
    """窗口信息响应"""

    hwnd: str
    title: str = ""


class WindowRectResponse(BaseModel):
    """窗口矩形响应"""

    left: int
    top: int
    right: int
    bottom: int


class WindowHandleResponse(BaseModel):
    """窗口句柄响应"""

    hwnd: str


class WindowFindRequest(BaseModel):
    """外部窗口搜索请求"""

    title: str = Field(min_length=1)
    match: str = Field(default="contains")
    limit: int = Field(default=10, ge=1, le=50)


class WindowHideEdgeRequest(BaseModel):
    """隐藏窗口到边缘请求"""

    hwnd: str = Field(min_length=1)
    edge: str = Field(default="left")
    peek_px: int = Field(default=0, ge=0, le=400)
    animate: bool = False
    duration_ms: int = Field(default=180, ge=60, le=1200)


class WindowNewPos(BaseModel):
    """窗口新位置"""

    x: int
    y: int


class WindowHideEdgeResponse(BaseModel):
    """隐藏窗口到边缘结果"""

    ok: bool
    hwnd: str
    rect: WindowRectResponse | None = None
    new_pos: WindowNewPos | None = None


class WindowRestoreRequest(BaseModel):
    """恢复窗口位置请求"""

    hwnd: str = Field(min_length=1)
    rect: WindowRectResponse
    animate: bool = False
    duration_ms: int = Field(default=180, ge=60, le=1200)


class WindowRestoreResponse(BaseModel):
    """恢复窗口位置结果"""

    ok: bool
    hwnd: str
