"""
知识库索引重建 —— 文档分块 + 批量向量化 + 持久化

对应 TypeScript 端 kb-indexer.ts
"""

import logging
import time

from app.configs.ai import AiConfig as RagRuntimeConfig
from app.core.embeddings import create_embeddings_model, format_embedding_error
from app.domains.agents.kb_chunker import chunk_knowledge_document
from app.domains.agents.kb_index_store import IndexedKnowledgeChunk, KbIndexStore, KnowledgeBaseIndex
from app.models.agents import AgentKnowledgeDoc

logger = logging.getLogger(__name__)


def _now_ms() -> float:
    return time.time() * 1000


async def rebuild_knowledge_base_index(
    kb_id: str,
    docs: list[AgentKnowledgeDoc],
    rag: RagRuntimeConfig,
    config_ai,
    ai_api_keys: dict[str, str],
    active_api_key: str,
    index_store: KbIndexStore,
) -> KnowledgeBaseIndex:
    """
    重建知识库向量索引

    1. 对所有文档分块
    2. 批量向量化所有分块
    3. 保存索引到磁盘
    """
    # 1. 分块
    chunk_groups = []
    for doc in docs:
        fragments = await chunk_knowledge_document(doc, rag)
        chunk_groups.append(fragments)

    all_fragments = [f for g in chunk_groups for f in g]

    if not all_fragments:
        index = KnowledgeBaseIndex(kb_id=kb_id, indexed_at=_now_ms(), chunks=[])
        index_store.save(index)
        return index

    # 2. 批量向量化
    texts = [f.text for f in all_fragments]
    try:
        embeddings_model = create_embeddings_model(config_ai, ai_api_keys, active_api_key)
        vectors = embeddings_model.embed_documents(texts)
    except Exception as e:
        raise ValueError(format_embedding_error(e)) from e

    # 3. 构建索引
    indexed_chunks = []
    for fragment, vec in zip(all_fragments, vectors):
        indexed_chunks.append(
            IndexedKnowledgeChunk(
                id=fragment.id,
                kb_id=fragment.kb_id,
                doc_id=fragment.doc_id,
                doc_title=fragment.doc_title,
                text=fragment.text,
                index=fragment.index,
                embedding=vec if vec else [],
            )
        )

    index = KnowledgeBaseIndex(kb_id=kb_id, indexed_at=_now_ms(), chunks=indexed_chunks)
    index_store.save(index)
    logger.info("知识库 %s 索引完成: %d 分块", kb_id, len(indexed_chunks))
    return index
