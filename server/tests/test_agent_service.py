import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import app.domains.agents.service as agent_service_module
from app.config import AppConfig
from app.domains.agents.service import AgentService
from app.models.agents import AgentConfig


class AgentServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_stream_excludes_current_user_message_from_history(self) -> None:
        captured_messages = []

        async def fake_run_chat_pipeline(**kwargs):
            captured_messages.extend(kwargs["conversation_messages"])
            yield {"type": "done", "full_text": "已完成", "rag_context": None}

        with TemporaryDirectory() as temp_dir:
            tmp_path = Path(temp_dir)
            service = AgentService(str(tmp_path))
            config = AppConfig()
            config.agents.configs = [
                AgentConfig(
                    id="agent-1",
                    name="助手",
                    system_prompt="你是助手",
                    knowledge_base_id=None,
                    created_at=0,
                    updated_at=0,
                )
            ]

            events = []
            with patch.object(agent_service_module, "run_chat_pipeline", fake_run_chat_pipeline):
                async for event in service.chat_stream(
                    conversation_id="conv-1",
                    agent_id="agent-1",
                    message="你好",
                    config=config,
                    api_key="test-key",
                ):
                    events.append(event)

            conversation = service.get_conversation("conv-1")

        self.assertEqual(captured_messages, [])
        self.assertEqual([message.role for message in conversation.messages], ["user", "assistant"])
        self.assertEqual(conversation.messages[0].content, "你好")
        self.assertEqual(conversation.messages[1].content, "已完成")
        self.assertEqual(events[-1]["type"], "completed")

    async def test_chat_stream_does_not_persist_empty_assistant_after_pipeline_error(self) -> None:
        async def fake_run_chat_pipeline(**_kwargs):
            yield {"type": "error", "message": "AI 请求失败"}

        with TemporaryDirectory() as temp_dir:
            tmp_path = Path(temp_dir)
            service = AgentService(str(tmp_path))
            config = AppConfig()
            config.agents.configs = [
                AgentConfig(
                    id="agent-1",
                    name="助手",
                    system_prompt="你是助手",
                    knowledge_base_id=None,
                    created_at=0,
                    updated_at=0,
                )
            ]

            events = []
            with patch.object(agent_service_module, "run_chat_pipeline", fake_run_chat_pipeline):
                async for event in service.chat_stream(
                    conversation_id="conv-1",
                    agent_id="agent-1",
                    message="你好",
                    config=config,
                    api_key="test-key",
                ):
                    events.append(event)

            conversation = service.get_conversation("conv-1")

        self.assertEqual(events, [{"type": "error", "message": "AI 请求失败"}])
        self.assertEqual([message.role for message in conversation.messages], ["user"])
