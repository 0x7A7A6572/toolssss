"""
核心工具模块

提供可复用的 LangChain Tool 定义，各 domain 按需引入。
"""

from app.core.tools.web_search import get_search_tools, search

__all__ = ["get_search_tools", "search"]
