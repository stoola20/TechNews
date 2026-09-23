from app.rag.embeddings import EmbeddingService
from app.repositories.chunks import ChunkRepository, RetrievedChunk


class SemanticRetriever:
    def __init__(self, embeddings: EmbeddingService, chunks: ChunkRepository):
        self.embeddings = embeddings
        self.chunks = chunks

    async def retrieve(self, query: str, top_k: int = 5) -> list[RetrievedChunk]:
        vectors = await self.embeddings.embed([query])
        return await self.chunks.search(vectors[0], top_k)
