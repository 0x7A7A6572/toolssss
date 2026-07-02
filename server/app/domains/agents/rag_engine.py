"""
RAG 检索引擎 —— 从知识库向量索引中检索相关文档片段

对应 TypeScript 端 rag-engine.ts
"""

from typing import Optional

from app.configs.main import AppConfig
from app.core.embeddings import create_embeddings_model
from app.domains.agents.kb_index_store import KbIndexStore, KnowledgeBaseIndex
from app.domains.agents.vector_search import RankedKnowledgeChunk, rank_indexed_chunks


class RagChunk:
    """RAG 检索结果片段"""
    def __init__(self, chunk_id: str, doc_id: str, doc_title: str, text: str, score: float):
        self.chunk_id = chunk_id
        self.doc_id = doc_id
        self.doc_title = doc_title
        self.text = text
        self.score = score


class RagContext:
    """RAG 检索上下文"""
    def __init__(self, chunks: list[RagChunk]):
        self.chunks = chunks


async def retrieve_from_knowledge_base(
    query: str,
    kb_id: Optional[str],
    config: AppConfig,
    api_key: str,
    index_store: KbIndexStore,
) -> RagContext:
    """
    从知识库向量索引中检索相关文档片段

    1. 加载知识库向量索引
    2. 对查询做向量化
    3. 余弦相似度排序，取 top-K
    """
    if not kb_id:
        return RagContext(chunks=[])

    index = index_store.load(kb_id)
    if not index.chunks:
        return RagContext(chunks=[])

    # 将查询文本向量化
    embeddings_model = create_embeddings_model(config.ai, config.ai_api_keys, config.api_key)
    query_vector = embeddings_model.embed_query(query)

    ranked = rank_indexed_chunks(index.chunks, query_vector, config.agents.rag.top_k)

    chunks = [
        RagChunk(
            chunk_id=c.id,
            doc_id=c.doc_id,
            doc_title=c.doc_title,
            text=c.text,
            score=c.score,
        )
        for c in ranked
    ]
    return RagContext(chunks=chunks)


def build_rag_context_prompt(rag: RagContext) -> str:
    """将 RAG 检索结果构建为注入到系统提示词的上下文文本"""
    if not rag.chunks:
        return ""

    context_parts = []
    for i, c in enumerate(rag.chunks):
        context_parts.append(f"[{i + 1}] {c.doc_title}：{c.text}")

    context = "\n\n".join(context_parts)
    return (
        f"\n\n以下是知识库中相关的参考资料：\n{context}\n\n"
        "请基于以上参考资料回答用户的问题。如果参考资料不足以回答问题，请如实告知。"
    )
