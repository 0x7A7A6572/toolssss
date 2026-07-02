"""
LLM 统一调用服务

跨 domain 共享的 LLM 调用封装，从 app.state.config 读取 AI 配置。
"""

import logging
from typing import AsyncIterator, Optional

from langchain_core.messages import BaseMessage

from app.configs.main import AppConfig
from app.core.ai_client import create_chat_model, invoke_text, stream_text
from app.core.exceptions import AiServiceError

logger = logging.getLogger(__name__)


def _resolve_api_key(config: AppConfig) -> str:
    """从配置中获取 API Key（由 Electron 通过 /config 推送）"""
    api_key = config.api_key
    if not api_key:
        raise AiServiceError("未配置 AI API Key")
    return api_key


async def llm_stream(
    config: AppConfig,
    messages: list[BaseMessage],
    signal: Optional["asyncio.Event"] = None,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> AsyncIterator[str]:
    """流式调用 LLM，返回文本增量迭代器"""
    api_key = _resolve_api_key(config)
    model = create_chat_model(config.ai, api_key, temperature=temperature, max_tokens=max_tokens)
    async for delta in stream_text(model, messages, signal):
        yield delta


async def llm_invoke(
    config: AppConfig,
    messages: list[BaseMessage],
    signal: Optional["asyncio.Event"] = None,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> str:
    """非流式调用 LLM，返回完整文本"""
    api_key = _resolve_api_key(config)
    model = create_chat_model(config.ai, api_key, temperature=temperature, max_tokens=max_tokens)
    return await invoke_text(model, messages, signal)
