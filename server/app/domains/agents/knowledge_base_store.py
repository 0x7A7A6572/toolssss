"""
知识库文档存储

对应 TypeScript 端 knowledge-base-store.ts
"""

import json
from pathlib import Path
from typing import Optional

from app.models.agents import AgentKnowledgeDoc, KnowledgeBaseConfig


class KnowledgeBaseStore:
    """知识库存储 —— 管理知识库元数据和文档"""

    def __init__(self, base_dir: str) -> None:
        self._root = Path(base_dir) / "agents" / "knowledge-bases"
        self._root.mkdir(parents=True, exist_ok=True)
        self._index_file = self._root / "index.json"

    def _read_index(self) -> list[dict]:
        """读取知识库索引文件"""
        if not self._index_file.exists():
            return []
        try:
            raw = self._index_file.read_text(encoding="utf-8")
            data = json.loads(raw)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, ValueError):
            return []

    def _write_index(self, items: list[dict]) -> None:
        """写入知识库索引文件"""
        self._index_file.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    def _docs_dir(self, kb_id: str) -> Path:
        return self._root / kb_id / "docs"

    def _doc_path(self, kb_id: str, doc_id: str) -> Path:
        return self._docs_dir(kb_id) / f"{doc_id}.json"

    # ---- 知识库 CRUD ----

    def list_knowledge_bases(self) -> list[KnowledgeBaseConfig]:
        """列出所有知识库"""
        items = self._read_index()
        return [KnowledgeBaseConfig.model_validate(item) for item in items]

    def save_knowledge_base(self, kb: KnowledgeBaseConfig) -> KnowledgeBaseConfig:
        """创建或更新知识库"""
        items = self._read_index()
        found = False
        for item in items:
            if item.get("id") == kb.id:
                item["name"] = kb.name
                kb = KnowledgeBaseConfig.model_validate(item)
                found = True
                break
        if not found:
            items.append({
                "id": kb.id,
                "name": kb.name,
                "docCount": kb.doc_count,
                "indexedAt": kb.indexed_at,
            })
        self._write_index(items)
        return kb

    def update_knowledge_base(self, kb_id: str, patch: dict) -> KnowledgeBaseConfig:
        """部分更新知识库配置"""
        items = self._read_index()
        for item in items:
            if item.get("id") == kb_id:
                item.update(patch)
                self._write_index(items)
                return KnowledgeBaseConfig.model_validate(item)
        raise ValueError(f"知识库 {kb_id} 不存在")

    def delete_knowledge_base(self, kb_id: str) -> None:
        """删除知识库及其所有文档"""
        items = [item for item in self._read_index() if item.get("id") != kb_id]
        self._write_index(items)
        kb_dir = self._root / kb_id
        if kb_dir.exists():
            import shutil
            shutil.rmtree(kb_dir, ignore_errors=True)

    # ---- 文档 CRUD ----

    def list_documents(self, kb_id: str) -> list[AgentKnowledgeDoc]:
        """列出知识库下的所有文档"""
        docs_dir = self._docs_dir(kb_id)
        if not docs_dir.exists():
            return []
        docs = []
        for f in sorted(docs_dir.glob("*.json")):
            try:
                raw = f.read_text(encoding="utf-8")
                data = json.loads(raw)
                data["kb_id"] = kb_id
                docs.append(AgentKnowledgeDoc.model_validate(data))
            except (json.JSONDecodeError, ValueError):
                continue
        return docs

    def save_document(self, kb_id: str, doc: AgentKnowledgeDoc) -> AgentKnowledgeDoc:
        """保存文档"""
        doc.kb_id = kb_id
        docs_dir = self._docs_dir(kb_id)
        docs_dir.mkdir(parents=True, exist_ok=True)
        self._doc_path(kb_id, doc.id).write_text(
            doc.model_dump_json(ensure_ascii=False), encoding="utf-8"
        )
        return doc

    def delete_document(self, kb_id: str, doc_id: str) -> bool:
        """删除文档"""
        try:
            self._doc_path(kb_id, doc_id).unlink()
            return True
        except FileNotFoundError:
            return False
