"""
Web 搜索 Tool

通过 langchain-mcp-adapters 连接 Parallel AI MCP Server，
提供 web_search 和 web_fetch 两个 LangChain Tool。
"""

import json
import logging
from typing import Optional

from langchain_mcp_adapters.client import MultiServerMCPClient

logger = logging.getLogger(__name__)

# Parallel AI 搜索 MCP 端点（免费，无需 API Key）
SEARCH_MCP_URL = "https://search.parallel.ai/mcp"

# 模块级客户端引用，保持 MCP 会话存活
_client: Optional[MultiServerMCPClient] = None
_tools: Optional[list] = None


async def get_search_tools() -> list:
    """获取搜索相关工具列表 [web_search, web_fetch]"""
    global _client, _tools

    if _tools is not None:
        return _tools

    _client = MultiServerMCPClient({
        "parallel_search": {
            "url": SEARCH_MCP_URL,
            "transport": "streamable_http",
        }
    })
    _tools = await _client.get_tools()
    logger.info("已加载 %d 个搜索工具: %s", len(_tools), [t.name for t in _tools])
    return _tools


async def search(
    objective: str,
    search_queries: list[str],
) -> dict:
    """
    执行 Web 搜索，返回格式化结果

    Args:
        objective: 搜索目标描述（一句话）
        search_queries: 搜索关键词列表（2-3 个）

    Returns:
        {"text": str, "result_count": int, "sources": list[str]}
    """
    tools = await get_search_tools()
    web_search = next((t for t in tools if t.name == "web_search"), None)
    if web_search is None:
        raise RuntimeError("未找到 web_search 工具")

    raw = await web_search.ainvoke({
        "objective": objective,
        "search_queries": search_queries,
    })

    data = _parse_result(raw)
    results = data.get("results", [])

    lines: list[str] = []
    sources: list[str] = []

    for r in results:
        if not isinstance(r, dict):
            continue
        if r.get("title"):
            lines.append(f"标题: {r['title']}")
        if r.get("url"):
            lines.append(f"链接: {r['url']}")
            sources.append(r["url"])
        excerpts = r.get("excerpts", [])
        if isinstance(excerpts, list):
            excerpt = " ".join(
                str(e).replace("\n", " ").strip() for e in excerpts if e
            )
            if excerpt:
                lines.append(f"摘要: {excerpt}")
        lines.append("---")

    text = "\n".join(lines)
    return {
        "text": text if len(text) > 50 else "",
        "result_count": len(results),
        "sources": sources,
    }


def _parse_result(raw) -> dict:
    """解析 MCP 搜索返回的原始 JSON 数据"""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            cleaned = raw.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return {"results": []}
    return {"results": []}
