import hashlib

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.extractor import ExtractedArticle
from app.models.article import Article
from app.models.chunk import ArticleChunk
from app.rag.chunker import TextChunk


class ArticleRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_articles(self) -> list[Article]:
        result = await self.session.scalars(select(Article).order_by(Article.published_at.desc().nullslast(), Article.id.desc()))
        return list(result)


class IngestionRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_content_hash(self, url: str) -> str | None:
        content_hash = await self.session.scalar(select(Article.content_hash).where(Article.source_url == url))
        await self.session.rollback()
        return content_hash

    async def save(self, extracted: ExtractedArticle, chunks: list[TextChunk], vectors: list[list[float]]) -> str:
        lock_key = int.from_bytes(hashlib.sha256(extracted.source_url.encode()).digest()[:8], "big", signed=True)
        async with self.session.begin():
            await self.session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            existing = await self.session.scalar(select(Article).where(Article.source_url == extracted.source_url))
            if existing and existing.content_hash == extracted.content_hash:
                return "unchanged"
            if existing:
                article = existing
                article.title = extracted.title
                article.author = extracted.author
                article.published_at = extracted.published_at
                article.content = extracted.content
                article.content_hash = extracted.content_hash
                await self.session.execute(delete(ArticleChunk).where(ArticleChunk.article_id == article.id))
                status = "updated"
            else:
                article = Article(
                    source="openai_developer_blog", source_url=extracted.source_url, title=extracted.title,
                    author=extracted.author, published_at=extracted.published_at,
                    content=extracted.content, content_hash=extracted.content_hash,
                )
                self.session.add(article)
                await self.session.flush()
                status = "new"
            self.session.add_all(
                ArticleChunk(article_id=article.id, chunk_index=index, content=chunk.content, token_count=chunk.token_count, embedding=vector)
                for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
            )
        return status
