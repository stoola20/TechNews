from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.chunk import ArticleChunk


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: int
    content: str
    score: float
    article_title: str
    article_url: str
    published_at: datetime | None
    chunk_index: int


class ChunkRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def search(self, vector: list[float], top_k: int) -> list[RetrievedChunk]:
        distance = ArticleChunk.embedding.cosine_distance(vector)
        statement = (
            select(ArticleChunk, Article, (1 - distance).label("score"))
            .join(Article, ArticleChunk.article_id == Article.id)
            .order_by(distance, ArticleChunk.id)
            .limit(top_k)
        )
        result = await self.session.execute(statement)
        return [
            RetrievedChunk(chunk.id, chunk.content, float(score), article.title, article.source_url, article.published_at, chunk.chunk_index)
            for chunk, article, score in result.all()
        ]
