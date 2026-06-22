import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.domains.agents.knowledge_base_store import KnowledgeBaseStore
from app.models.agents import KnowledgeBaseConfig


class KnowledgeBaseStoreTests(unittest.TestCase):
    def test_delete_knowledge_base_removes_entire_directory(self) -> None:
        with TemporaryDirectory() as temp_dir:
            tmp_path = Path(temp_dir)
            store = KnowledgeBaseStore(str(tmp_path))
            kb = KnowledgeBaseConfig(id="kb-1", name="知识库", doc_count=1, indexed_at=123)
            store.save_knowledge_base(kb)

            kb_dir = tmp_path / "agents" / "knowledge-bases" / "kb-1"
            docs_dir = kb_dir / "docs"
            docs_dir.mkdir(parents=True, exist_ok=True)
            (kb_dir / "vector-index.json").write_text(
                '{"kbId":"kb-1","indexedAt":123,"chunks":[]}', encoding="utf-8"
            )
            (docs_dir / "doc-1.json").write_text("{}", encoding="utf-8")

            store.delete_knowledge_base("kb-1")

            self.assertFalse(kb_dir.exists())

    def test_save_knowledge_base_keeps_existing_counts_on_rename(self) -> None:
        with TemporaryDirectory() as temp_dir:
            tmp_path = Path(temp_dir)
            store = KnowledgeBaseStore(str(tmp_path))
            original = KnowledgeBaseConfig(id="kb-1", name="旧名字", doc_count=3, indexed_at=456)
            store.save_knowledge_base(original)

            renamed = store.save_knowledge_base(
                KnowledgeBaseConfig(id="kb-1", name="新名字", doc_count=0, indexed_at=None)
            )

            self.assertEqual(renamed.name, "新名字")
            self.assertEqual(renamed.doc_count, 3)
            self.assertEqual(renamed.indexed_at, 456)
