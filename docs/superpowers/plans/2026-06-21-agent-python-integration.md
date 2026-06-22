# Agent Python Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the renderer's agent chat and knowledge-base flows use the Python backend through one shared adapter, while keeping IPC fallback working.

**Architecture:** Keep the existing dual-backend design, but stop leaking it into pages. The renderer talks only to one adapter/composable layer; that layer decides whether to call Python HTTP or Electron IPC. Fix protocol mismatches and startup config sync so Python mode actually works.

**Tech Stack:** Electron, Vue 3, TypeScript, FastAPI, Pydantic

---

### Task 1: Freeze The Gap List

**Files:**
- Modify: `f:\codes\toolssss\src\renderer\src\views\AgentChat\composables\useAgentChat.ts`
- Modify: `f:\codes\toolssss\src\renderer\src\components\AgentSettingsPanel.vue`
- Modify: `f:\codes\toolssss\src\renderer\src\composables\useAgentBackend.ts`
- Modify: `f:\codes\toolssss\src\renderer\src\utils\python-api.ts`
- Modify: `f:\codes\toolssss\src\main\core\python-server.ts`

- [ ] **Step 1: Record the current breakpoints**

```text
1. Agent chat view still calls IPC directly through useAgentChat.
2. Agent settings knowledge-base actions still call IPC directly.
3. Python HTTP client uses methods that do not match FastAPI routes.
4. Python HTTP payloads are snake_case, but renderer expects camelCase.
5. Initial config push is skipped because pushConfigToPython() requires status === "running".
```

- [ ] **Step 2: Keep the fix narrow**

```text
Do not delete the IPC backend.
Do not rewrite the Python server.
Do not change the visible UI contract of AgentChatView.vue.
```

### Task 2: Repair The Python Client Contract

**Files:**
- Modify: `f:\codes\toolssss\src\renderer\src\utils\python-api.ts`

- [ ] **Step 1: Normalize Python responses to shared camelCase shapes**

```ts
function normalizeConversation(raw: unknown): AgentConversation {
  const item = raw as Record<string, unknown>
  return {
    id: String(item.id ?? ''),
    agentId: String(item.agentId ?? item.agent_id ?? ''),
    title: String(item.title ?? ''),
    messages: Array.isArray(item.messages) ? item.messages.map(normalizeMessage) : [],
    createdAt: Number(item.createdAt ?? item.created_at ?? Date.now()),
    updatedAt: Number(item.updatedAt ?? item.updated_at ?? Date.now())
  }
}
```

- [ ] **Step 2: Match the FastAPI HTTP methods**

```ts
renameConversation(id: string, title: string): Promise<AgentConversation> {
  return requestJson(`/api/agents/conversations/${id}/rename`, {
    method: 'PUT',
    body: { title }
  }).then(normalizeConversation)
}
```

- [ ] **Step 3: Add document and reindex helpers with typed results**

```ts
listDocuments(kbId: string): Promise<AgentKnowledgeDoc[]> {
  return get(`/api/agents/knowledge-bases/${kbId}/docs`).then((rows) =>
    Array.isArray(rows) ? rows.map(normalizeKnowledgeDoc) : []
  )
}
```

### Task 3: Centralize Renderer Backend Switching

**Files:**
- Modify: `f:\codes\toolssss\src\renderer\src\composables\useAgentBackend.ts`

- [ ] **Step 1: Expand the adapter so pages do not touch IPC directly**

```ts
async function listDocuments(kbId: string): Promise<AgentKnowledgeDoc[]> {
  if (pythonAvailable.value) return knowledgeBaseApi.listDocuments(kbId)
  return (await window.electron.ipcRenderer.invoke('agent:kb:doc:list', { kbId })) as AgentKnowledgeDoc[]
}
```

- [ ] **Step 2: Keep dual-backend behavior in one place**

```ts
return {
  backendMode,
  pythonAvailable,
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  renameConversation,
  clearConversation,
  chatStream,
  listKnowledgeBases,
  saveKnowledgeBase,
  deleteKnowledgeBase,
  listDocuments,
  saveDocument,
  deleteDocument,
  reindexKnowledgeBase
}
```

### Task 4: Switch Chat State To The Adapter

**Files:**
- Modify: `f:\codes\toolssss\src\renderer\src\views\AgentChat\composables\useAgentChat.ts`

- [ ] **Step 1: Replace direct IPC CRUD calls with adapter calls**

```ts
const backend = useAgentBackend()
const list = await backend.listConversations()
```

- [ ] **Step 2: Handle both Python SSE and IPC stream modes**

```ts
const result = await backend.chatStream(conversationId, currentAgentId.value, message)
if (result.mode === 'python') {
  bindPythonStream(result.eventSource, conversationId)
} else {
  pendingStreamId.value = result.streamId
}
```

- [ ] **Step 3: Keep cancel behavior explicit**

```ts
if (activePythonStream.value) {
  activePythonStream.value.close()
  activePythonStream.value = null
}
```

### Task 5: Switch Knowledge-Base Panel To The Adapter

**Files:**
- Modify: `f:\codes\toolssss\src\renderer\src\components\AgentSettingsPanel.vue`

- [ ] **Step 1: Route knowledge-base CRUD through useAgentBackend()**

```ts
const backend = useAgentBackend()
const list = await backend.listKnowledgeBases()
const docs = await backend.listDocuments(kb.id)
```

- [ ] **Step 2: Keep agent config writes in settings store**

```text
Agent config editing still belongs to settings:update because Electron remains the settings authority.
Only knowledge-base document/index operations move behind the backend adapter.
```

### Task 6: Fix Python Startup Config Sync

**Files:**
- Modify: `f:\codes\toolssss\src\main\core\python-server.ts`

- [ ] **Step 1: Mark the Python server running before the first config push**

```ts
status = 'running'
await pushConfigToPython()
restartCount = 0
return pythonPort
```

- [ ] **Step 2: Keep pushConfigToPython() guarded for real stopped states**

```ts
if ((status !== 'running' && status !== 'starting') || !pythonPort || !deps) return
```

### Task 7: Verify The Wiring

**Files:**
- Test: `f:\codes\toolssss\src\renderer\src\utils\python-api.ts`
- Test: `f:\codes\toolssss\src\renderer\src\views\AgentChat\composables\useAgentChat.ts`
- Test: `f:\codes\toolssss\src\renderer\src\components\AgentSettingsPanel.vue`

- [ ] **Step 1: Run TypeScript diagnostics**

```bash
pnpm exec tsc -p tsconfig.web.json --noEmit
```

- [ ] **Step 2: Run project diagnostics for edited files**

```text
Check python-api.ts, useAgentBackend.ts, useAgentChat.ts, AgentSettingsPanel.vue, python-server.ts.
```

- [ ] **Step 3: Smoke-check behavior**

```text
1. With Python unavailable, chat still uses IPC and keeps working.
2. With Python available, conversation list/chat/doc actions succeed through HTTP.
3. First Python startup receives config without waiting for a later settings update.
```
