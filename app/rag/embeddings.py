from typing import Protocol

from openai import AsyncOpenAI


class EmbeddingService(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAIEmbeddingService:
    def __init__(self, client: AsyncOpenAI, model: str, dimensions: int, batch_size: int = 100):
        self.client = client
        self.model = model
        self.dimensions = dimensions
        self.batch_size = batch_size

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for offset in range(0, len(texts), self.batch_size):
            batch = texts[offset : offset + self.batch_size]
            response = await self.client.embeddings.create(model=self.model, dimensions=self.dimensions, input=batch)
            ordered = sorted(response.data, key=lambda item: item.index)
            if len(ordered) != len(batch) or any(len(item.embedding) != self.dimensions for item in ordered):
                raise ValueError("Embedding response count or dimensions did not match request")
            vectors.extend(item.embedding for item in ordered)
        return vectors
