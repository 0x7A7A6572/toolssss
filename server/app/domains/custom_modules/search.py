"""
MCP Web 搜索客户端

通过子进程 + JSON-RPC 与 MCP 搜索服务通信。

对应 TypeScript 端 @main-core/mcp-client.ts
"""

import asyncio
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# =============================================================================
# MCP JSON-RPC 核心
# =============================================================================

_REQUEST_ID = 0


def _next_id() -> int:
    global _REQUEST_ID
    _REQUEST_ID += 1
    return _REQUEST_ID


async def _read_line(stream: asyncio.StreamReader) -> Optional[str]:
    """读取一行 JSON-RPC 响应"""
    try:
        line = await stream.readline()
        if not line:
            return None
        return line.decode("utf-8").strip()
    except Exception:
        return None


async def _send_request(
    writer: asyncio.StreamWriter,
    method: str,
    params: Optional[dict] = None,
) -> int:
    """发送 JSON-RPC 请求，返回 request id"""
    req_id = _next_id()
    request = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
        "params": params or {},
    }
    line = json.dumps(request, ensure_ascii=False) + "\n"
    writer.write(line.encode("utf-8"))
    await writer.drain()
    return req_id


async def _wait_for_response(
    reader: asyncio.StreamReader,
    target_id: int,
    signal: Optional[asyncio.Event] = None,
) -> dict:
    """等待指定 id 的 JSON-RPC 响应"""
    while True:
        if signal and signal.is_set():
            raise asyncio.CancelledError("MCP 请求已取消")

        line = await _read_line(reader)
        if not line:
            continue

        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue

        if isinstance(parsed, dict) and parsed.get("id") == target_id:
            if "error" in parsed:
                err = parsed["error"]
                msg = err.get("message", "MCP 未知错误") if isinstance(err, dict) else str(err)
                raise RuntimeError(f"MCP 返回错误: {msg}")
            return parsed


# =============================================================================
# 搜索结果解析
# =============================================================================


def _parse_search_results_json(text: str) -> Optional[dict]:
    """解析 MCP 搜索返回的 JSON 结果"""
    try:
        cleaned = text.replace("```json", "").replace("```", "").strip()
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return None

        results = data.get("results")
        if not isinstance(results, list) or not results:
            return None

        lines = []
        sources = []
        for r in results:
            if not isinstance(r, dict):
                continue
            if r.get("title"):
                lines.append(f"标题: {r['title']}")
            if r.get("url"):
                lines.append(f"链接: {r['url']}")
                try:
                    from urllib.parse import urlparse
                    hostname = urlparse(r["url"]).hostname
                    if hostname:
                        sources.append(hostname)
                except Exception:
                    sources.append(r["url"])
            excerpts = r.get("excerpts")
            if isinstance(excerpts, list) and excerpts:
                excerpt = " ".join(str(e).replace("\\n", " ").strip() for e in excerpts)
                if excerpt:
                    lines.append(f"摘要: {excerpt}")
            lines.append("---")

        out = "\n".join(lines)
        if len(out) <= 50:
            return None
        return {"text": out, "result_count": len(results), "sources": sources}
    except (json.JSONDecodeError, KeyError):
        return None


# =============================================================================
# 公开接口
# =============================================================================


async def run_mcp_search(
    command: str,
    objective: str,
    search_queries: list[str],
    signal: Optional[asyncio.Event] = None,
) -> dict:
    """
    运行 MCP Web 搜索

    Args:
        command: MCP 启动命令（如 "npx -y mcp-remote https://search.parallel.ai/mcp"）
        objective: 搜索目标描述
        search_queries: 搜索关键词列表
        signal: 取消信号

    Returns:
        {"text": str, "result_count": int, "sources": list[str]}
    """
    if not command.strip():
        raise ValueError("未配置 MCP 搜索命令")

    # 解析命令
    parts = command.strip().split()
    cmd = parts[0]
    args = parts[1:]

    logger.info("启动 MCP 搜索: %s %s", cmd, " ".join(args[:2]))

    try:
        proc = await asyncio.create_subprocess_exec(
            cmd,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        reader = proc.stdout
        writer = proc.stdin

        if not reader or not writer:
            raise RuntimeError("无法建立 MCP 进程 IO 管道")

        try:
            # 1. 初始化
            init_id = await _send_request(
                writer,
                "initialize",
                {
                    "protocolVersion": "2024-11-20",
                    "capabilities": {},
                    "clientInfo": {"name": "forge-studio", "version": "1.0"},
                },
            )
            await _wait_for_response(reader, init_id, signal)
            logger.info("MCP 初始化完成")

            # 2. 发现工具（可选，仅日志）
            list_id = await _send_request(writer, "tools/list")
            tools_result = await _wait_for_response(reader, list_id, signal)
            result_data = tools_result.get("result", {})
            if isinstance(result_data, dict):
                tools = result_data.get("tools", [])
                if isinstance(tools, list):
                    names = [t.get("name", "?") for t in tools if isinstance(t, dict)]
                    logger.info("MCP 可用工具: %s", ", ".join(names))

            # 3. 调用搜索
            search_id = await _send_request(
                writer,
                "tools/call",
                {
                    "name": "web_search",
                    "arguments": {
                        "objective": objective,
                        "search_queries": search_queries,
                    },
                },
            )
            raw = await _wait_for_response(reader, search_id, signal)
            content = raw.get("result", {}).get("content", [])

            if not isinstance(content, list) or not content:
                return {"text": "", "result_count": 0, "sources": []}

            # 4. 解析结果
            texts = []
            total_count = 0
            all_sources = set()

            for block in content:
                if not isinstance(block, dict):
                    continue
                text = block.get("text", "")
                if not text or not text.strip():
                    continue

                parsed = _parse_search_results_json(text.strip())
                if parsed:
                    texts.append(parsed["text"])
                    total_count += parsed["result_count"]
                    for src in parsed["sources"]:
                        all_sources.add(src)
                else:
                    texts.append(text.strip())

            logger.info("MCP 搜索完成: %d 文本块, %d 条结果", len(texts), total_count)
            return {
                "text": "\n\n".join(texts),
                "result_count": total_count,
                "sources": list(all_sources),
            }
        finally:
            # 确保清理子进程
            try:
                proc.kill()
            except Exception:
                pass
    except Exception as e:
        logger.error("MCP 搜索异常: %s", e)
        raise
