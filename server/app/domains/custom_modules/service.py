"""
自定义模块业务逻辑

编排 AI 流式生成、Web 搜索、Prompt 增强的完整流程。

对应 TypeScript 端 custom-modules/index.ts
"""

import asyncio
import logging
from typing import AsyncIterator, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.core.ai_client import create_chat_model
from app.models.custom_modules import SearchMeta

logger = logging.getLogger(__name__)

# =============================================================================
# 系统提示词（对应 TypeScript 端 buildSystemPrompt）
# =============================================================================

SYSTEM_PROMPTS = {
    "text": "你是一个知识丰富的助手。根据用户的要求输出简洁、准确的内容。可以直接输出内容。",
    "text_md": "你是一个知识丰富的助手。根据用户的要求输出简洁、准确的内容。可以使用 Markdown 格式排版。",
    "ranking": (
        "你是一个数据分析师。根据用户的要求输出结构化的排行榜数据，"
        "必须只输出 JSON 格式，不要附加任何解释或标记。"
        'JSON 格式：{"rankings":[{"title":"榜单标题","items":["项目1","项目2","项目3"]}]}。'
        "如果有多个维度，可以在 rankings 数组中包含多个元素。"
    ),
    "link": (
        "你是一个资讯编辑。根据用户的要求输出结构化的信息列表，"
        "必须只输出 JSON 格式，不要附加任何解释或标记。"
        'JSON 格式：{"items":[{"title":"标题","link":"https://...","description":"简短描述"}]}。'
        "其中 link 字段必须是真实可访问的 URL，description 为可选字段。"
    ),
    "chart": (
        "你是一个数据可视化专家。根据用户的要求输出结构化的图表数据，"
        "必须只输出 JSON 格式，不要附加任何解释或标记。"
        'JSON 格式：{"charts":[{"title":"图表标题","type":"bar","labels":["标签1","标签2","标签3"],'
        '"series":[{"name":"系列名","type":"bar","data":[10,20,30]}]}]}。'
        "支持的 type 有：bar（柱状图）, line（折线图）, pie（饼图）。"
        "series 支持多系列，适合对比数据。"
    ),
}

ENHANCE_PROMPT_SYSTEM = (
    "你是一个专业的提示词优化专家。你的任务是根据用户提供的模块标题、"
    "现有提示词和模块类型，优化并完善这条提示词。\n\n"
    "要求：\n"
    "1. 保持原有的核心意图和需求\n"
    "2. 补充具体的细节、格式要求、约束条件，使提示词更清晰、可执行\n"
    "3. 根据模块类型（text=生成文字, ranking=数据排行, link=资讯简报, chart=数据图表）调整输出格式指引\n"
    "4. 使提示词更加结构化，明确输出要求\n"
    "5. 如果原有提示词已经很好，可以小幅优化，不要过度修改\n"
    "6. 只输出优化后的提示词本身，不要输出任何解释、前缀或标记"
)

SEARCH_EXTRACT_SYSTEM = (
    "你是一个搜索参数提取专家。你的任务是根据用户的需求，提取出适合搜索的关键词。\n\n"
    "要求：\n"
    "1. objective（字符串）：一句话概括用户想搜索什么，去掉格式要求和输出格式指令，只保留核心搜索意图\n"
    "2. search_queries（字符串数组）：具体搜索关键词列表，每一条应该独立、明确、可直接用于搜索。生成 3-5 个不同角度的搜索词\n\n"
    "注意：去除用户提示词中的\"JSON格式\"、\"以XX格式输出\"、\"包含XX字段\"等格式要求，只保留搜索意图。\n\n"
    "必须只输出 JSON 格式，不要附加任何解释或标记。\n"
    'JSON 格式：{"objective": "搜索目标描述", "search_queries": ["关键词1", "关键词2"]}'
)


# =============================================================================
# 服务函数
# =============================================================================


def _build_system_prompt(module_type: str, enable_markdown: bool = False) -> str:
    """根据模块类型构建系统提示词"""
    if enable_markdown and module_type == "text":
        return SYSTEM_PROMPTS["text_md"]
    return SYSTEM_PROMPTS.get(module_type, SYSTEM_PROMPTS["text"])


def _build_max_tokens(module_type: str, web_search: bool = False) -> int:
    """根据模块类型决定 max_tokens"""
    base = 16384
    return base * 2 if web_search else base


async def run_module_stream(
    *,
    config: AppConfig,
    api_key: str,
    module_type: str,
    prompt: str,
    web_search: bool = False,
    enable_markdown: bool = False,
    signal: Optional[asyncio.Event] = None,
) -> AsyncIterator[dict]:
    """
    自定义模块流式生成

    事件格式：
    - {"type": "searching", "status": "searching"}
    - {"type": "delta", "delta": str}
    - {"type": "done", "text": str, "search_meta": Optional[SearchMeta]}
    - {"type": "error", "message": str}
    """
    try:
        final_prompt = prompt
        search_meta: Optional[SearchMeta] = None

        # 1. 可选的 Web 搜索（通过 MCP 子进程）
        if web_search:
            yield {"type": "searching", "status": "searching"}
            try:
                from app.domains.custom_modules.search import run_mcp_search

                search_cmd = config.ai.search_mcp_command
                objective = prompt.replace("```", "").strip()[:200] or prompt[:200]

                # 从 prompt 中提取 3-5 个搜索关键词
                lines = [l.strip() for l in prompt.replace("，", ",").replace("、", ",").split(",")]
                search_queries = [l for l in lines if len(l) > 4][:5]
                if not search_queries:
                    search_queries = [objective]

                mcp_result = await run_mcp_search(
                    command=search_cmd,
                    objective=objective,
                    search_queries=search_queries,
                    signal=signal,
                )

                if mcp_result["text"]:
                    search_meta = SearchMeta(
                        result_count=mcp_result["result_count"],
                        sources=mcp_result["sources"],
                    )
                    final_prompt = (
                        f"基于以下搜索结果来回答用户的问题，请直接使用搜索结果中的信息，不要编造。\n\n"
                        f"搜索结果：\n{mcp_result['text']}\n\n"
                        f"用户问题/要求：\n{prompt}"
                    )
                    logger.info(
                        "MCP 搜索完成: %d 条结果, %d 个来源",
                        mcp_result["result_count"],
                        len(mcp_result["sources"]),
                    )
            except Exception as e:
                logger.error("MCP 搜索失败: %s", e)
                # 搜索失败不影响主流程，直接用原 prompt 请求 AI

        # 2. 构建消息
        system_prompt = _build_system_prompt(module_type, enable_markdown)
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=final_prompt),
        ]

        # 3. 流式生成
        model = create_chat_model(
            config=config.ai,
            api_key=api_key,
            temperature=0.7,
            max_tokens=_build_max_tokens(module_type, web_search),
        )

        full_text = ""
        stream = model.stream(messages)
        for chunk in stream:
            if signal and signal.is_set():
                break
            content = getattr(chunk, "content", None)
            if isinstance(content, str) and content:
                full_text += content
                yield {"type": "delta", "delta": content}

        # 4. 完成
        yield {
            "type": "done",
            "text": full_text.strip(),
            "search_meta": search_meta,
        }

    except Exception as e:
        if signal and signal.is_set():
            return
        logger.error("自定义模块流式异常: %s", e)
        yield {"type": "error", "message": f"AI 请求失败: {e}"}


async def enhance_prompt(
    config: AppConfig,
    api_key: str,
    title: str,
    prompt: str,
    module_type: str,
) -> str:
    """
    使用 AI 优化用户提示词

    对应 TypeScript 端 ENHANCE_PROMPT 逻辑
    """
    type_label = {
        "text": "生成文字",
        "ranking": "数据排行",
        "link": "资讯简报",
        "chart": "数据图表",
    }.get(module_type, "生成文字")

    user_content = f"模块标题：{title}\n模块类型：{type_label}\n当前提示词：{prompt}\n\n请优化以上提示词，使其更加完善和可执行。"

    messages = [
        SystemMessage(content=ENHANCE_PROMPT_SYSTEM),
        HumanMessage(content=user_content),
    ]

    model = create_chat_model(
        config=config.ai,
        api_key=api_key,
        temperature=0.5,
        max_tokens=600,
    )

    result = model.invoke(messages)
    content = getattr(result, "content", "")
    return str(content).strip() if content else prompt
