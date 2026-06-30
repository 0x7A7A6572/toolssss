"""
AI 服务域路由

提供 AI 模型配置的 CRUD 端点。
"""

from fastapi import APIRouter

from app.configs.ai import AI_PROVIDER, AiModel, ProviderInfo
from app.domains.ai.service import ai_model_service

router = APIRouter()


# =============================================================================
# 服务商信息
# =============================================================================


@router.get("/providers")
async def list_providers() -> list[ProviderInfo]:
    """获取所有服务商信息（含预设 base_url 和模型列表），前端用此渲染下拉框"""
    return [
        ProviderInfo(
            provider=v["provider"],
            title=v["title"],
            base_url=v["base_url"],
            models=v["models"],
        )
        for k, v in AI_PROVIDER.items()
        if k != "custom"
    ]


# =============================================================================
# 模型 CRUD
# =============================================================================


@router.get("")
async def list_models():
    """获取所有 AI 模型（返回脱敏后的 api_key）"""
    models = ai_model_service.list_models()
    return [_mask_api_key(m) for m in models]


@router.get("/{model_id}")
async def get_model(model_id: str):
    """获取单个 AI 模型（返回脱敏后的 api_key）"""
    model = ai_model_service.get_model(model_id)
    return _mask_api_key(model)


@router.post("")
async def create_model(body: AiModel):
    """创建 AI 模型，名称未填时自动生成"""
    ai_model_service.create_model(body)
    return _mask_api_key(body)


@router.put("/{model_id}")
async def update_model(model_id: str, body: AiModel):
    """更新 AI 模型（完全替换），api_key 为空则保留原值"""
    updated = ai_model_service.update_model(model_id, body)
    return _mask_api_key(updated)


@router.delete("/{model_id}")
async def delete_model(model_id: str):
    """删除 AI 模型"""
    ai_model_service.delete_model(model_id)
    return {"deleted": True}


# =============================================================================
# 辅助
# =============================================================================


def _mask_api_key(model: AiModel) -> dict:
    """脱敏 api_key：只保留前4后4位"""
    data = model.model_dump()
    key = data.get("api_key", "")
    if isinstance(key, str) and len(key) > 8:
        data["api_key"] = key[:4] + "****" + key[-4:]
    elif isinstance(key, str) and key:
        data["api_key"] = key[:2] + "****"
    return data
