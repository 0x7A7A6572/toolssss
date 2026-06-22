from app.config import AiSettings
from app.core.ai_client import create_chat_model
from app.core.embeddings import (
    EmbeddingModelConfig,
    create_embeddings_model,
    resolve_embedding_model_config,
)
from langchain_core.messages import HumanMessage


def test_create_chat_model_uses_normalized_base_url() -> None:
    config = AiSettings(
        model="gpt-4o-mini",
        baseUrl="https://example.com/v1/chat/completions",
    )

    model = create_chat_model(config, api_key="test-key")

    assert model.openai_api_base == "https://example.com/v1"


def test_create_embeddings_model_uses_normalized_base_url() -> None:
    config = AiSettings(
        baseUrl="https://chat.example.com/v1",
        activeProfileId="chat-profile",
        profiles=[
            {
                "id": "chat-profile",
                "name": "Chat",
                "provider": "custom",
                "source": "custom",
                "baseUrl": "https://chat.example.com/v1",
                "model": "chat-model",
                "apiKeySet": True,
                "modelType": "llm",
            },
            {
                "id": "embed-profile",
                "name": "Embedding",
                "provider": "custom",
                "source": "custom",
                "baseUrl": "https://embed.example.com",
                "model": "text-embedding-3-small",
                "apiKeySet": True,
                "modelType": "embedding",
            },
        ],
        embedding={
            "enabled": True,
            "profileId": "embed-profile",
            "model": "legacy-model-should-be-ignored",
            "dimensions": 1024,
        },
    )

    model = create_embeddings_model(config, api_keys={"embed-profile": "test-key"})

    assert model.openai_api_base == "https://embed.example.com/v1"
    assert model.dimensions == 1024


def test_create_chat_model_uses_deepseek_max_tokens_compat_field() -> None:
    config = AiSettings(
        provider="deepseek",
        model="deepseek-v4-flash",
        baseUrl="https://api.deepseek.com",
    )

    model = create_chat_model(config, api_key="test-key", max_tokens=1024)
    payload = model._get_request_payload([HumanMessage(content="hi")], stop=None, stream=True)

    assert payload["extra_body"] == {"max_tokens": 1024}
    assert "max_completion_tokens" not in payload


def test_resolve_embedding_model_config_uses_profile_id_and_profile_key() -> None:
    config = AiSettings(
        provider="deepseek",
        baseUrl="https://api.deepseek.com",
        model="deepseek-v4-flash",
        activeProfileId="chat-profile",
        profiles=[
            {
                "id": "chat-profile",
                "name": "Chat",
                "provider": "deepseek",
                "source": "provider",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash",
                "apiKeySet": True,
                "modelType": "llm",
            },
            {
                "id": "embed-profile",
                "name": "Embedding",
                "provider": "custom",
                "source": "custom",
                "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "model": "text-embedding-v3",
                "apiKeySet": True,
                "modelType": "embedding",
            },
        ],
        embedding={
            "enabled": True,
            "profileId": "embed-profile",
            "model": "legacy-model-should-be-ignored",
            "dimensions": 1024,
        },
    )

    resolved, api_key = resolve_embedding_model_config(
        config,
        api_keys={"chat-profile": "chat-key", "embed-profile": "embed-key"},
        active_api_key="active-chat-key",
    )

    assert resolved == EmbeddingModelConfig(
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="text-embedding-v3",
        profile_id="embed-profile",
        provider="custom",
        dimensions=1024,
    )
    assert api_key == "embed-key"
