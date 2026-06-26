# Python Embedding Profile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Python backend resolve embedding requests from `settings.ai.embedding.profileId` against `settings.ai.profiles`, and use the matching profile's `baseUrl`, `model`, `provider`, and API key instead of reusing the active chat profile.

**Architecture:** Extend the Python config snapshot so it preserves `profiles` plus a per-profile API key map from Electron. Then add a Python-side embedding profile resolver that mirrors the existing TypeScript logic and route all RAG embedding calls through that resolver. Keep the chat profile path unchanged.

**Tech Stack:** Electron main process, TypeScript, Python, FastAPI, Pydantic, LangChain OpenAI

---

### Task 1: Preserve AI Profiles And Keys In Python Config

**Files:**

- Modify: `f:\codes\toolssss\server\app\config.py`
- Modify: `f:\codes\toolssss\src\main\core\python-server.ts`

- [ ] Add Python config models for `AiProfile` and `profiles`, plus an `api_keys` map keyed by profile id.
- [ ] Keep existing `api_key` for the active chat profile so current chat path does not regress.
- [ ] Push both `settings.ai.profiles` and resolved per-profile API keys from Electron to Python `/config`.

### Task 2: Resolve Embedding Profile On Python Side

**Files:**

- Modify: `f:\codes\toolssss\server\app\core\embeddings.py`

- [ ] Add a Python embedding resolver that reads `config.embedding.profile_id`, finds the matching entry in `config.profiles`, validates model type, and resolves the correct API key from the synced key map.
- [ ] Build `OpenAIEmbeddings` from the resolved profile instead of `config.base_url`.
- [ ] Keep current user-facing error messages or improve them only where they become more accurate.

### Task 3: Rewire RAG Calls And Guard With Tests

**Files:**

- Modify: `f:\codes\toolssss\server\app\domains\agents\rag_engine.py`
- Modify: `f:\codes\toolssss\server\app\domains\agents\kb_indexer.py`
- Modify: `f:\codes\toolssss\server\tests\test_openai_factories.py`

- [ ] Route query embedding and document indexing through the new Python embedding resolver.
- [ ] Add focused tests that prove Python now uses the embedding profile's `base_url`, `model`, and profile-specific API key.
- [ ] Run diagnostics on touched files and do a payload-level smoke check if the local Python test environment is incomplete.
