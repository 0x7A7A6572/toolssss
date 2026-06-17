import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import type { AgentKnowledgeDoc } from '@shared/agents'
import type { RagRuntimeConfig } from '@shared/settings'

export interface ChunkedKnowledgeDocument {
  id: string
  kbId: string
  docId: string
  docTitle: string
  text: string
  index: number
}

export async function chunkKnowledgeDocument(
  doc: AgentKnowledgeDoc,
  rag: RagRuntimeConfig
): Promise<ChunkedKnowledgeDocument[]> {
  // 用 LangChain 的 RecursiveCharacterTextSplitter 做分块，优先按标题/段落/中文标点切，
  // 这样不会把文档切得像碎玻璃，同时还能保留必要的 overlap 给后续检索。
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: rag.chunkSize,
    chunkOverlap: rag.chunkOverlap,
    separators: ['\n## ', '\n### ', '\n\n', '\n', '。', '！', '？', '；', '，', ' ']
  })

  const texts = await splitter.splitText(doc.content)
  return texts.map((text, index) => ({
    id: `${doc.id}#${index}`,
    kbId: doc.kbId,
    docId: doc.id,
    docTitle: doc.title,
    text,
    index
  }))
}
