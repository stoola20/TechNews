import pytest

from app.ingestion.pipeline import IngestionPipeline
from app.rag.chunker import TokenChunker


ARTICLE_URL = "https://developers.openai.com/blog/example"


def html(body: str) -> str:
    return f"<article><h1>Example</h1><p>{body}</p></article>"


class FakeDiscovery:
    async def discover(self):
        return [ARTICLE_URL]


class FakeFetcher:
    def __init__(self):
        self.body = "Initial content"

    async def fetch(self, url):
        return html(self.body)


class FakeRepository:
    def __init__(self):
        self.articles = {}
        self.chunks = {}

    async def get_content_hash(self, url):
        return self.articles[url].content_hash if url in self.articles else None

    async def save(self, extracted, chunks, vectors):
        old = self.articles.get(extracted.source_url)
        if old and old.content_hash == extracted.content_hash:
            return "unchanged"
        self.articles[extracted.source_url] = extracted
        self.chunks[extracted.source_url] = chunks
        return "updated" if old else "new"


class FakeEmbeddings:
    def __init__(self):
        self.calls = 0

    async def embed(self, texts):
        self.calls += 1
        return [[1.0, 0.0] for _ in texts]


@pytest.mark.asyncio
async def test_duplicate_ingestion_and_hash_change():
    fetcher = FakeFetcher()
    repository = FakeRepository()
    embeddings = FakeEmbeddings()
    pipeline = IngestionPipeline(FakeDiscovery(), fetcher, repository, TokenChunker(100, 10), embeddings)
    first = await pipeline.ingest_source()
    assert (first.new_articles, first.updated_articles, first.chunks_created) == (1, 0, 1)
    second = await pipeline.ingest_source()
    assert (second.new_articles, second.updated_articles, second.chunks_created) == (0, 0, 0)
    assert embeddings.calls == 1
    assert len(repository.articles) == len(repository.chunks) == 1
    old_hash = repository.articles[ARTICLE_URL].content_hash
    fetcher.body = "Updated content"
    third = await pipeline.ingest_source()
    assert (third.new_articles, third.updated_articles, third.chunks_created) == (0, 1, 1)
    assert repository.articles[ARTICLE_URL].content_hash != old_hash
    assert len(repository.chunks[ARTICLE_URL]) == 1
