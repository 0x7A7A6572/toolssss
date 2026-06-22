"""
自定义模块 Pydantic 模型

对应 TypeScript 端 @shared/custom-modules 中的类型定义。
"""

from typing import Optional

from pydantic import BaseModel


class ModuleStreamRequest(BaseModel):
    """自定义模块流式生成请求"""
    module_id: str
    type: str = "text"  # "text" | "ranking" | "link" | "chart"
    prompt: str
    web_search: bool = False
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
