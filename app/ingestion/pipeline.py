import logging
from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.ingestion.discovery import BlogDiscovery
from app.ingestion.extractor import extract_article
from app.ingestion.fetcher import ArticleFetcher
from app.rag.chunker import TokenChunker
from app.rag.embeddings import EmbeddingService, OpenAIEmbeddingService
from app.repositories.articles import IngestionRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IngestionResult:
    discovered: int = 0
    new_articles: int = 0
    updated_articles: int = 0
    chunks_created: int = 0


class IngestionPipeline:
    def __init__(self, discovery: BlogDiscovery, fetcher: ArticleFetcher, repository: IngestionRepository, chunker: TokenChunker, embeddings: EmbeddingService):
        self.discovery = discovery
        self.fetcher = fetcher
        self.repository = repository
        self.chunker = chunker
        self.embeddings = embeddings

    async def ingest_source(self) -> IngestionResult:
        urls = await self.discovery.discover()
        new_articles = updated_articles = chunks_created = 0
        for url in urls:
            extracted = extract_article(await self.fetcher.fetch(url), url)
            if await self.repository.get_content_hash(extracted.source_url) == extracted.content_hash:
                continue
            chunks = self.chunker.chunk(extracted.content)
            vectors = await self.embeddings.embed([chunk.content for chunk in chunks])
            status = await self.repository.save(extracted, chunks, vectors)
            if status == "new":
                new_articles += 1
                chunks_created += len(chunks)
            elif status == "updated":
                updated_articles += 1
                chunks_created += len(chunks)
            logger.info("ingested_article", extra={"article_url": url, "status": status, "chunks": len(chunks) if status != "unchanged" else 0})
        return IngestionResult(len(urls), new_articles, updated_articles, chunks_created)


async def ingest_source() -> IngestionResult:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": "DeveloperKnowledgeBase/0.1"}) as http_client:
        async with AsyncOpenAI(api_key=settings.openai_api_key) as openai_client:
            async with SessionLocal() as session:
                pipeline = IngestionPipeline(
                    BlogDiscovery(http_client), ArticleFetcher(http_client), IngestionRepository(session),
                    TokenChunker(settings.chunk_size, settings.chunk_overlap),
                    OpenAIEmbeddingService(openai_client, settings.openai_embedding_model, settings.embedding_dimensions),
                )
                return await pipeline.ingest_source()
