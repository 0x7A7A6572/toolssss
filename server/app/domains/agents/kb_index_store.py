"""
知识库向量索引持久化

对应 TypeScript 端 kb-index-store.ts
"""

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


class IndexedKnowledgeChunk(BaseModel):
    """已索引的知识分块"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    id: str
    kb_id: str = Field(validation_alias="kbId", serialization_alias="kbId")
    doc_id: str = Field(validation_alias="docId", serialization_alias="docId")
    doc_title: str = Field(validation_alias="docTitle", serialization_alias="docTitle")
    text: str
    index: int
    embedding: list[float]


class KnowledgeBaseIndex(BaseModel):
    """知识库向量索引"""
    model_config = {"populate_by_name": True, "serialize_by_alias": True}

    kb_id: str = Field(validation_alias="kbId", serialization_alias="kbId")
    indexed_at: Optional[float] = Field(
        default=None, validation_alias="indexedAt", serialization_alias="indexedAt"
    )
    chunks: list[IndexedKnowledgeChunk] = []


class KbIndexStore:
    """向量索引文件存储"""

    def __init__(self, base_dir: str) -> None:
        self._root = Path(base_dir) / "agents" / "knowledge-bases"

    def _index_path(self, kb_id: str) -> Path:
        return self._root / kb_id / "vector-index.json"

    def load(self, kb_id: str) -> KnowledgeBaseIndex:
        """加载向量索引"""
        path = self._index_path(kb_id)
        if not path.exists():
            return KnowledgeBaseIndex(kb_id=kb_id)
        try:
            raw = path.read_text(encoding="utf-8")
            return KnowledgeBaseIndex.model_validate_json(raw)
        except (json.JSONDecodeError, ValueError):
            return KnowledgeBaseIndex(kb_id=kb_id)

    def save(self, index: KnowledgeBaseIndex) -> None:
        """保存向量索引"""
        path = self._index_path(index.kb_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(index.model_dump_json(ensure_ascii=False), encoding="utf-8")
