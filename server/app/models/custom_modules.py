"""
自定义模块 Pydantic 模型

对应 TypeScript 端 @shared/custom-modules 中的类型定义。
"""

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field


class ModuleRequest(BaseModel):
    """模块请求"""
    module_id: str
    prompt: str
    web_search: bool = False


class ModuleStreamRequest(ModuleRequest):
    """自定义模块流式生成请求"""
    type: str = "text"  # "text" | "ranking" | "link" | "chart"
    enable_markdown: bool = False




class ModuleCancelRequest(BaseModel):
    """取消生成请求"""
    id: str


class ModuleEnhanceRequest(BaseModel):
    """Prompt 增强请求"""
    title: str = ""
    prompt: str = ""
    type: str = "text"


class StreamResponse(BaseModel):
    """流式请求初始响应"""
    id: str
    module_id: str


class SearchMeta(BaseModel):
    """搜索元信息"""
    result_count: int
    sources: list[str]


class ModuleDonePayload(BaseModel):
    """流式生成完成推送数据"""
    id: str
    module_id: str
    text: str
    search_meta: Optional[SearchMeta] = None


# =============================================================================
# 模块配置与缓存数据模型（对应前端 src/shared/custom-modules.ts）
# =============================================================================

UpdateFrequency = Literal["realtime", "daily", "weekly", "monthly"]
ModuleType = Literal["text", "ranking", "link", "chart"]


class CustomModuleConfig(BaseModel):
    """模块配置（持久化到 {userDataPath}/custom-modules/modules/{id}.json）"""
    id: str
    name: str
    type: ModuleType = "text"
    prompt: str
    created_at: float
    web_search: bool = False
    min_height: Optional[int] = None
    max_height: Optional[Union[int, str]] = None  # int 或 'auto'
    enable_markdown: bool = False
    update_frequency: UpdateFrequency = "realtime"


class CustomModuleCache(BaseModel):
    """模块缓存内容（持久化到 {userDataPath}/custom-modules/cache/{id}.json）"""
    text: Optional[str] = None
    rankings: Optional[list[dict]] = None
    links: Optional[list[dict]] = None
    charts: Optional[list[dict]] = None
    raw_text: Optional[str] = None
    updated_at: float
    search_meta: Optional[SearchMeta] = None


# =============================================================================
# 模块 CRUD 请求模型
# =============================================================================


class ModuleCreateRequest(BaseModel):
    """创建模块请求"""
    name: str
    type: ModuleType = "text"
    prompt: str
    web_search: bool = False
    min_height: Optional[int] = None
    max_height: Optional[Union[int, str]] = None
    enable_markdown: bool = False
    update_frequency: UpdateFrequency = "realtime"


class ModuleUpdateRequest(BaseModel):
    """更新模块请求（所有字段可选，PATCH 语义）"""
    name: Optional[str] = None
    type: Optional[ModuleType] = None
    prompt: Optional[str] = None
    web_search: Optional[bool] = None
    min_height: Optional[int] = Field(default=None, json_schema_extra={"nullable": True})
    max_height: Optional[Union[int, str]] = Field(default=None, json_schema_extra={"nullable": True})
    enable_markdown: Optional[bool] = None
    update_frequency: Optional[UpdateFrequency] = None


class ModuleCacheUpdateRequest(BaseModel):
    """更新模块缓存请求"""
    text: Optional[str] = None
    rankings: Optional[list[dict]] = None
    links: Optional[list[dict]] = None
    charts: Optional[list[dict]] = None
    raw_text: Optional[str] = None
    search_meta: Optional[SearchMeta] = None
