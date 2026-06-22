"""
向量相似度搜索 —— 余弦相似度 + Top-K 排序

对应 TypeScript 端 vector-search.ts
"""

import math

from app.domains.agents.kb_index_store import IndexedKnowledgeChunk


class RankedKnowledgeChunk(IndexedKnowledgeChunk):
    """带相似度分数的分块"""
    score: float = 0.0


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """计算两个向量的余弦相似度"""
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = 0.0
    mag_a = 0.0
    mag_b = 0.0

    for va, vb in zip(a, b):
        dot += va * vb
        mag_a += va * va
        mag_b += vb * vb

    if not mag_a or not mag_b:
        return 0.0
    return dot / (math.sqrt(mag_a) * math.sqrt(mag_b))


def rank_indexed_chunks(
    chunks: list[IndexedKnowledgeChunk],
    query_vector: list[float],
    top_k: int,
) -> list[RankedKnowledgeChunk]:
    """对分块按与查询向量的余弦相似度排序，取 top-K"""
    scored = []
    for chunk in chunks:
        score = cosine_similarity(chunk.embedding, query_vector)
        if score > 0:
            scored.append(
                RankedKnowledgeChunk(
                    id=chunk.id,
                    kb_id=chunk.kb_id,
                    doc_id=chunk.doc_id,
                    doc_title=chunk.doc_title,
                    text=chunk.text,
                    index=chunk.index,
                    embedding=chunk.embedding,
                    score=score,
                )
            )
    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:top_k]
