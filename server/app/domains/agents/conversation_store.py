"""
对话文件持久化存储

存储路径：{userDataPath}/agents/conversations/{id}.json

对应 TypeScript 端 conversation-store.ts
"""

import json
import time
import uuid
from pathlib import Path
from typing import Optional

from app.models.agents import AgentConversation


def _now_ms() -> float:
    return time.time() * 1000


def generate_id(prefix: str) -> str:
    """生成唯一 ID"""
    return f"{prefix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


class ConversationStore:
    """对话持久化存储"""

    def __init__(self, base_dir: str) -> None:
        self._dir = Path(base_dir) / "agents" / "conversations"
        self._ensure_dir()

    def _ensure_dir(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)

    def _file_path(self, conv_id: str) -> Path:
        return self._dir / f"{conv_id}.json"

    def list_all(self) -> list[AgentConversation]:
        """列出所有对话，按更新时间降序"""
        self._ensure_dir()
        conversations = []
        for f in sorted(self._dir.glob("*.json")):
            conv = self.load(f.stem)
            if conv:
                conversations.append(conv)
        conversations.sort(key=lambda c: c.updated_at, reverse=True)
        return conversations

    def load(self, conv_id: str) -> Optional[AgentConversation]:
        """加载单个对话"""
        try:
            raw = self._file_path(conv_id).read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                return None
            conv = AgentConversation.model_validate(data)
            return conv
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            return None

    def save(self, conv: AgentConversation) -> None:
        """保存对话"""
        self._ensure_dir()
        conv.updated_at = _now_ms()
        self._file_path(conv.id).write_text(
            conv.model_dump_json(ensure_ascii=False), encoding="utf-8"
        )

    def delete(self, conv_id: str) -> bool:
        """删除对话"""
        try:
            self._file_path(conv_id).unlink()
            return True
        except FileNotFoundError:
            return False
