"""
AI API 调用封装 —— 流式/非流式文本生成

对应 TypeScript 端 @main-core/ai-service.ts 的功能。
使用 langchain-openai 的 ChatOpenAI 实现 OpenAI-compatible API 调用。
"""

import logging
from typing import AsyncIterator, Optional

from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_openai import ChatOpenAI

from app.config import AiSettings
from app.core.exceptions import AiServiceError

logger = logging.getLogger(__name__)


def normalize_base_url(base_url: str) -> str:
    """
    规范化 base URL 为 ChatOpenAI 可用格式

    ChatOpenAI 内部会在 baseURL 后自动追加 /chat/completions，
    因此需要移除用户可能已包含的后缀。
    """
    base = base_url.strip()
    if not base:
        raise AiServiceError("未配置 AI Base URL")

    normalized = base.rstrip("/")
    # 去掉已包含的 /chat/completions
    if normalized.endswith("/chat/completions"):
        normalized = normalized[: -len("/chat/completions")]
    elif normalized.endswith("/openai"):
        pass  # Gemini 风格
    elif normalized.endswith("/v1"):
        pass  # 已包含版本号
    else:
        normalized = f"{normalized}/v1"

    return normalized


def create_chat_model(
    config: AiSettings,
    api_key: str,
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
) -> ChatOpenAI:
    """创建 LangChain ChatOpenAI 实例"""
    kwargs = {
        "model": config.model,
        "api_key": api_key,
        "temperature": temperature,
        "base_url": normalize_base_url(config.base_url),
        "stream_usage": False,  # 兼容非 OpenAI 提供商
    }

    # DeepSeek OpenAI-compatible chat expects `max_tokens`.
    # langchain-openai 1.3.x rewrites explicit `max_tokens=` into
    # `max_completion_tokens`, which breaks DeepSeek compatibility.
    if max_tokens is not None:
        if config.provider == "deepseek":
            kwargs["extra_body"] = {"max_tokens": max_tokens}
        else:
            kwargs["max_tokens"] = max_tokens

    return ChatOpenAI(**kwargs)


async def stream_text(
    model: ChatOpenAI,
    messages: list[BaseMessage],
    signal: Optional["asyncio.Event"] = None,
) -> AsyncIterator[str]:
    """
    流式生成文本

    Yields:
        每个文本增量片段

    如果 signal 被 set，中断流式生成。
    """
    import asyncio

    try:
        stream = model.stream(messages)
        for chunk in stream:
            # 检查取消信号
            if signal and signal.is_set():
                break
            content = getattr(chunk, "content", None)
            if isinstance(content, str) and content:
                yield content
    except Exception as e:
        logger.error("AI 流式请求失败: %s", e)
        raise AiServiceError(f"AI 请求失败: {e}") from e


async def invoke_text(
    model: ChatOpenAI,
    messages: list[BaseMessage],
    signal: Optional["asyncio.Event"] = None,
) -> str:
    """
    非流式文本生成

    Returns:
        完整生成文本

    Raises:
        AiServiceError: AI 未返回有效内容时
    """
    import asyncio

    if signal and signal.is_set():
        raise AiServiceError("请求已被取消")

    try:
        result = model.invoke(messages)
        content = getattr(result, "content", None)
        if not isinstance(content, str) or not content.strip():
            raise AiServiceError("AI 未返回有效内容")
        return content
    except AiServiceError:
        raise
    except Exception as e:
        logger.error("AI 非流式请求失败: %s", e)
        raise AiServiceError(f"AI 请求失败: {e}") from e
