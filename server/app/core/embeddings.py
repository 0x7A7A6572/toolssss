"""
向量嵌入服务

对应 TypeScript 端 @main-core/ai-service.ts 的 embeddings 部分。
"""

from dataclasses import dataclass
import logging
from typing import Optional

from langchain_openai import OpenAIEmbeddings

# from app.config import AiSettings
from app.core.ai_client import normalize_base_url
from app.core.exceptions import AiServiceError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddingModelConfig:
    """Embedding 模型运行时配置"""

    base_url: str
    model: str
    profile_id: str
    provider: str
    dimensions: Optional[int]


def _is_rerank_model(model: str) -> bool:
    return "rerank" in model.lower()


def _is_likely_non_text_embedding_model(model: str) -> bool:
    lowered = model.lower()
    keywords = ("vision", "multimodal", "image", "video", "audio", "-vl-", "_vl_")
    return any(keyword in lowered for keyword in keywords)


def _assert_embedding_chain_supported(profile, model: str) -> None:
    if profile.model_type != "embedding":
        profile_name = profile.name.strip() or model
        raise AiServiceError(
            f"当前选择的模型「{profile_name}」类型为「{profile.model_type}」，不是向量模型，不能用于 RAG 索引。"
        )

    if _is_rerank_model(model):
        raise AiServiceError(f"当前模型「{model}」是重排模型，不是向量模型，不能用于 RAG 索引。")

    if _is_likely_non_text_embedding_model(model):
        raise AiServiceError(
            f"当前模型「{model}」属于视觉或多模态向量模型，现有 RAG 链路只支持 OpenAI-compatible 文本向量模型。"
        )


def resolve_embedding_model_config(
    config: AiSettings,
    api_keys: Optional[dict[str, str]] = None,
    active_api_key: str = "",
) -> tuple[EmbeddingModelConfig, str]:
    """按 embedding.profile_id 解析独立的 Embedding Profile 配置"""
    if not config.embedding.enabled:
        raise AiServiceError("未启用 Embedding 配置")

    profile_id = config.embedding.profile_id.strip()
    if not profile_id:
        raise AiServiceError("未选择 Embedding Profile")

    profile = next((item for item in config.profiles if item.id == profile_id), None)
    if not profile:
        raise AiServiceError("未找到 Embedding Profile")

    model_name = profile.model.strip() or config.embedding.model.strip()
    if not model_name:
        raise AiServiceError("未配置 Embedding Model")

    _assert_embedding_chain_supported(profile, model_name)

    keys = api_keys or {}
    api_key = (keys.get(profile_id) or "").strip()
    if not api_key and profile_id == config.active_profile_id.strip():
        api_key = active_api_key.strip()
    if not api_key:
        raise AiServiceError("未配置 Embedding Profile API Key")

    return (
        EmbeddingModelConfig(
            base_url=profile.base_url,
            model=model_name,
            profile_id=profile_id,
            provider=profile.provider,
            dimensions=config.embedding.dimensions or None,
        ),
        api_key,
    )


def create_embeddings_model(
    config: AiSettings,
    api_keys: Optional[dict[str, str]] = None,
    active_api_key: str = "",
    dimensions: Optional[int] = None,
) -> OpenAIEmbeddings:
    """创建 LangChain OpenAIEmbeddings 实例"""
    resolved, api_key = resolve_embedding_model_config(config, api_keys, active_api_key)

    return OpenAIEmbeddings(
        model=resolved.model,
        api_key=api_key,
        dimensions=dimensions or resolved.dimensions,
        base_url=normalize_base_url(resolved.base_url),
    )


def format_embedding_error(error: Exception) -> str:
    """格式化 embedding 错误为用户可读信息"""
    msg = str(error)
    if "Unsupported model" in msg or "model_not_supported" in msg or "MODEL_NOT_FOUND" in msg:
        return (
            f"当前所选向量模型不支持现有 RAG 链路。请选择支持 OpenAI-compatible embeddings "
            f"的文本向量模型，例如 text-embedding-v3。原始错误：{msg}"
        )
    return msg
