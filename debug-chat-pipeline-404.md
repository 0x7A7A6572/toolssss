# [OPEN] Chat Pipeline 404

## Symptom

- `PythonServer:err` reports: `聊天管道异常: Error code: 404`

## Session

- sessionId: `chat-pipeline-404`
- status: `OPEN`

## Falsifiable Hypotheses

1. The frontend/backend requests a wrong route, so the upstream returns HTTP 404.
2. A dev proxy or server rewrite is misconfigured, so the request never reaches the expected Python endpoint.
3. The Python service is running, but the chat endpoint path changed and the caller still uses an old URL.
4. Environment variables or base URL construction are broken, producing an incomplete or wrong request target.
5. The 404 is not from the Python backend at all, but from Vite/dev-server fallback or another intermediate service.

## Evidence Plan

- Locate the code path that emits `聊天管道异常`.
- Trace request URL construction and any proxy forwarding.
- Identify whether the 404 originates in frontend, dev server, or Python service.
- Compare Python `langchain-openai` request payload with the old IPC TypeScript payload.

## Evidence

- FastAPI chat route itself returns `200 OK`, so the local `/api/agents/.../chat` route exists and works.
- Removing the agent knowledge base still reproduces `404`, so the failure is not limited to the RAG embeddings branch.
- Current runtime settings use DeepSeek chat:
  - `provider=deepseek`
  - `baseUrl=https://api.deepseek.com`
  - `model=deepseek-v4-flash`
- Python runtime uses `langchain-openai 1.3.2` and `openai 2.43.0`.
- Introspection of Python `ChatOpenAI(..., max_tokens=16384).stream(...)` shows the outgoing payload uses:
  - `max_completion_tokens: 16384`
  - endpoint path: `/v1/chat/completions`
- Introspection of the old TypeScript `@langchain/openai 1.4.7` IPC path shows the outgoing payload uses:
  - `max_tokens: 16384`
  - endpoint path: `/v1/chat/completions`
- DeepSeek official docs/examples require `max_tokens` for chat completion requests, not `max_completion_tokens`.

## Current Conclusion

- The strongest confirmed mismatch is Python LangChain/OpenAI request serialization for DeepSeek chat.
- Old IPC path and new Python path hit the same endpoint, but they do not send the same token-limit field.
- Working theory: DeepSeek rejects or mishandles Python's `max_completion_tokens` payload for this chat call, which surfaces as `Error code: 404` in the current client stack.

## Notes

- No business logic changed yet.
