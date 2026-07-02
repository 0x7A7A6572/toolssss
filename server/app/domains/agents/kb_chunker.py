"""
文档分块 —— 使用 LangChain RecursiveCharacterTextSplitter

对应 TypeScript 端 kb-chunker.ts
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel

# from app.configs import RagRuntimeConfig
from app.models.agents import AgentKnowledgeDoc


class ChunkedDocumentFragment(BaseModel):
    """分块后的文档片段"""
    id: str
    kb_id: str
    doc_id: str
    doc_title: str
    text: str
    index: int


async def chunk_knowledge_document(
    doc: AgentKnowledgeDoc,
    rag: RagRuntimeConfig,
) -> list[ChunkedDocumentFragment]:
    """
    将知识库文档按 RAG 配置分块

    使用 RecursiveCharacterTextSplitter 优先按标题/段落/中文标点分割，
    保留 overlap 供后续检索。
    """
    from pydantic import BaseModel as _BaseModel

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=rag.chunk_size,
        chunk_overlap=rag.chunk_overlap,
        separators=[
            "\n## ",
            "\n### ",
            "\n\n",
            "\n",
            "。",
            "！",
            "？",
            "；",
            "，",
            " ",
        ],
    )

    texts = splitter.split_text(doc.content)
    fragments = []
    for i, text in enumerate(texts):
        fragment = ChunkedDocumentFragment(
            id=f"{doc.id}#{i}",
            kb_id=doc.kb_id,
            doc_id=doc.id,
            doc_title=doc.title,
            text=text,
            index=i,
        )
        fragments.append(fragment)
    return fragments
